import { HeartRateMonitor, SimulatedHeartRate } from './heart.js';
import { loadFaceLandmarker, startCamera, eachFrame, drawMirrored } from './vision.js';
import { toScores } from './expressions.js';
import { PolygraphSensors } from './polygraph-sensors.js';
import { VoiceAnalyzer } from './voice-stress.js';
import { speak, stopSpeaking, listen, canListen } from './voice.js';
import { CALIBRATION, WARMUPS, INTRO, WARMUP_INTRO, THINKING, BackupHost } from './polygraph-lines.js';

const VERDICT = {
  busted: 'BUSTED',
  suspicious: 'SUSPICIOUS',
  hmm: 'HMM…',
  cool: 'TRUTHFUL',
};

const SILENCE_END_MS = 1800; // stop listening after this much quiet following their last word
const NO_ANSWER_MS = 12_000; // give up if they never start talking
const ANSWER_TIMEOUT_MS = 45_000;
const TRACE_POINTS = 170;

const $ = id => document.getElementById(id);
const video = $('video');
const cam = $('cam');
const ctx = cam.getContext('2d');
const sensors = new PolygraphSensors();
const voice = new VoiceAnalyzer();
const trace = { hr: [], voice: [], stress: [] };

let heart = null;
let cameraOn = false;
let answering = null; // { resolve, mic, snap, snapped, bestStress, cleanup }
let liveStress = 0;
let backup = new BackupHost();

init();

async function init() {
  fetch('/api/config')
    .then(r => r.json())
    .then(c => setStatus(c.claude
      ? (c.tts ? 'Claude + voice ready' : 'Claude ready, browser voice')
      : `${c.claudeError}. Using backup questions`))
    .catch(() => setStatus('Run server.py for Claude + voice'));

  // Names only (never the notes), so the host can pick a player who has a dossier.
  fetch('/api/dossiers/names')
    .then(r => r.json())
    .then(names => $('dossier-names').replaceChildren(
      ...names.map(n => Object.assign(document.createElement('option'), { value: n })),
    ))
    .catch(() => {});

  if (!HeartRateMonitor.supported) $('hr-connect').disabled = true;
  if (!canListen) $('answer').placeholder = 'Speech recognition needs Chrome. Type the answer, then press Done.';
  setInterval(updateLive, 200);

  try {
    const landmarker = await loadFaceLandmarker(1);
    await startCamera(video, cam);
    cameraOn = true;
    eachFrame(video, t => {
      const result = landmarker.detectForVideo(video, t);
      drawMirrored(ctx, video);
      if (result.faceBlendshapes[0]) sensors.addFace(toScores(result.faceBlendshapes[0]));
    });
  } catch (err) {
    console.error(err);
    $('tells').innerHTML = `<li>Camera unavailable: ${err.message}. Face cues are off.</li>`;
  }
  $('begin').disabled = false;
}

// ---------------------------------------------------------------- heart rate

$('hr-connect').onclick = async () => {
  const monitor = new HeartRateMonitor();
  wireHeart(monitor);
  try {
    await monitor.connect();
  } catch (err) {
    monitor.disconnect();
    if (err.name !== 'NotFoundError') $('hr-status').textContent = `Failed: ${err.message}`;
  }
};

$('hr-demo').onclick = () => {
  const sim = new SimulatedHeartRate();
  wireHeart(sim);
  sim.connect();
};

function wireHeart(source) {
  heart?.disconnect();
  heart = source;
  source.addEventListener('status', e => {
    const { state, name } = e.detail;
    $('hr-status').textContent = state === 'connected' ? `❤ ${name}` : state;
  });
  source.addEventListener('reading', e => sensors.addHeart(e.detail));
}

// ---------------------------------------------------------------- game flow

$('begin').onclick = () => run().catch(err => {
  console.error(err);
  setPhase(`Something broke: ${err.message}`);
});

async function run() {
  const name = $('name').value.trim() || 'Mystery Guest';
  const spice = $('spice').value;
  const rounds = Number($('rounds').value);
  $('setup').hidden = true;
  $('report').hidden = true;
  $('history').replaceChildren();
  $('title').textContent = '';
  backup = new BackupHost(spice);

  try {
    await voice.start();
    sensors.voice = voice;
  } catch (err) {
    console.warn('Voice analysis off:', err.message);
  }

  setPhase('Calibration');
  await host(INTRO(name));
  for (const q of CALIBRATION(name)) {
    const { raw } = await ask(q);
    sensors.calibrate(raw);
  }

  setPhase('Warm-up');
  await host(WARMUP_INTRO);
  const profile = [];
  for (const q of pick(WARMUPS, 3)) {
    const { answer, raw } = await ask(q);
    sensors.calibrate(raw); // relaxed, longer answers make a good voice baseline
    profile.push({ q, a: answer });
  }

  setPhase('Hot seat');
  $('question').textContent = '';
  host(THINKING);
  let turn = await callHost('start', { name, spice, rounds, baseline: sensors.baseline, profile });
  const session = turn.session;
  const results = [];
  let main = 0;
  let previousWasMain = false;

  while (turn.question) {
    // Claude may dig into the last main question once before moving on.
    const isFollowup = Boolean(turn.followup) && previousWasMain;
    if (!isFollowup) {
      if (main >= rounds) break;
      main++;
    }
    setPhase(isFollowup ? `Hot seat · follow-up on question ${main}` : `Hot seat · question ${main} of ${rounds}`);
    setTitle(turn.title);
    await host(turn.say);

    const question = turn.question;
    const { answer, raw, snap } = await ask(question, { hot: true });
    const reading = sensors.judge(raw, { question, answer });
    showVerdict(reading);
    results.push({ question, answer, snap, followup: isFollowup, ...reading });

    turn = await callHost('answer', {
      session, round: main, rounds, question, answer, followup: isFollowup, canFollowUp: !isFollowup,
      reading: { verdict: reading.verdict, stress: reading.stress, tells: reading.tells },
    });
    previousWasMain = !isFollowup;
  }

  setPhase('Final report');
  const averageStress = results.reduce((s, r) => s + r.stress, 0) / Math.max(1, results.length);
  const finalTurn = callHost('finish', { session, averageStress }); // runs while the last reaction is spoken
  setTitle(turn.title);
  await host(turn.say);
  const report = await finalTurn;
  showReport(report, results);
  await host(report.say);
}

// Reads a question aloud, then listens until they stop talking (or Done / Pass).
async function ask(question, { hot = false } = {}) {
  $('stamp').hidden = true;
  $('tells').replaceChildren();
  $('question').textContent = question;
  $('answer').value = '';
  await speak(question);

  sensors.startAnswer();
  if (hot && heart instanceof SimulatedHeartRate && Math.random() < 0.6) heart.spike(8 + Math.random() * 25);
  const mic = listen(text => ($('answer').value = text));
  const startedAt = performance.now();
  const snap = document.createElement('canvas');
  setAnswering(true, mic.active);

  const passed = await new Promise(resolve => {
    const check = setInterval(() => {
      const now = performance.now();
      if (!mic.active || document.activeElement === $('answer')) return; // typing: wait for Done
      if (mic.lastWordAt && now - mic.lastWordAt > SILENCE_END_MS) resolve(false);
      else if (!mic.firstWordAt && now - startedAt > NO_ANSWER_MS) resolve(false);
    }, 150);
    const timeout = setTimeout(() => resolve(false), ANSWER_TIMEOUT_MS);
    answering = {
      resolve, mic, snap, snapped: false, bestStress: -1,
      cleanup: () => { clearInterval(check); clearTimeout(timeout); },
    };
  });
  answering.cleanup();
  const snapped = answering.snapped;
  answering = null;
  setAnswering(false);

  const typed = $('answer').value.trim();
  const spoken = await mic.stop();
  const raw = sensors.endAnswer(mic.firstWordAt);
  const answer = passed ? 'pass' : typed || spoken;
  addHistory(question, answer);
  return { answer, raw, snap: snapped ? snap : null };
}

async function host(text) {
  if (!text) return;
  $('host-line').textContent = text;
  await speak(text);
}

async function callHost(step, body) {
  try {
    const res = await fetch(`/api/polygraph/${step}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    return data;
  } catch (err) {
    console.warn('Claude unavailable, using the backup host:', err.message);
    const turn = step === 'start' ? backup.start() : step === 'answer' ? backup.answer(body) : backup.finish(body);
    return { session: body.session, ...turn };
  }
}

// ---------------------------------------------------------------- live readout

function updateLive() {
  $('bpm').textContent = sensors.hasHeart ? Math.round(sensors.bpm) : '--';
  const raw = sensors.current(answering?.mic.firstWordAt);
  if (raw) {
    // Live needle only: the tells stay secret until the answer is over.
    const { stress } = sensors.judge(raw);
    liveStress = stress;
    setNeedle(stress);
    $('stress').textContent = stress;
    if (answering && cameraOn && stress > answering.bestStress) {
      answering.bestStress = stress;
      captureFace(answering.snap);
      answering.snapped = true;
    }
  } else {
    liveStress *= 0.9;
  }
  pushTrace();
}

// Remembers the guiltiest-looking moment of each answer for Exhibit A.
function captureFace(target) {
  target.width = 480;
  target.height = Math.round((480 * cam.height) / cam.width);
  target.getContext('2d').drawImage(cam, 0, 0, target.width, target.height);
}

function pushTrace() {
  // The pens tremble more as stress rises: pure theatre.
  const shake = scale => (Math.random() - 0.5) * liveStress * scale;
  const push = (series, value) => {
    series.push(value);
    if (series.length > TRACE_POINTS) series.shift();
  };
  push(trace.hr, sensors.hasHeart ? sensors.bpm + shake(0.25) : null);
  push(trace.voice, voice.pitch ? voice.pitch + shake(1) : null);
  push(trace.stress, liveStress + shake(0.3));
  drawTrace();
}

function drawTrace() {
  const canvas = $('trace');
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.fillStyle = '#f3ecd9';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(190, 70, 70, .18)';
  g.lineWidth = 1;
  for (let x = 0; x < W; x += 20) g.strokeRect(x, 0, 0, H);
  for (let y = 0; y < H; y += 20) g.strokeRect(0, y, W, 0);

  const lane = (series, color, lo, hi, top, height) => {
    g.strokeStyle = color;
    g.lineWidth = 2.5;
    g.beginPath();
    let penDown = false;
    series.forEach((v, i) => {
      if (v === null) {
        penDown = false;
        return;
      }
      const x = (i / (TRACE_POINTS - 1)) * W;
      const y = top + height - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * height;
      if (penDown) g.lineTo(x, y);
      else g.moveTo(x, y);
      penDown = true;
    });
    g.stroke();
  };
  lane(trace.hr, '#c0392b', 50, 140, 6, 56);
  lane(trace.voice, '#2c5aa0', 75, 350, 72, 56);
  lane(trace.stress, '#2b2b2b', 0, 100, 138, 56);
}

// ---------------------------------------------------------------- UI

$('done').onclick = () => answering?.resolve(false);
$('pass').onclick = () => answering?.resolve(true);
$('again').onclick = () => {
  stopSpeaking();
  $('report').hidden = true;
  $('setup').hidden = false;
  $('name').value = '';
  $('name').focus();
};
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && answering && document.activeElement !== $('answer')) {
    e.preventDefault();
    answering.resolve(false);
  }
});

function setAnswering(on, listening = false) {
  $('done').disabled = $('pass').disabled = !on;
  $('answer').classList.toggle('live', on);
  $('listen-hint').hidden = !(on && listening);
}

function setNeedle(stress) {
  $('needle').style.transform = `rotate(${-90 + stress * 1.8}deg)`;
}

function showVerdict({ verdict, stress, tells }) {
  liveStress = stress;
  setNeedle(stress);
  $('stress').textContent = stress;
  const stamp = $('stamp');
  stamp.className = `stamp ${verdict}`;
  stamp.textContent = VERDICT[verdict];
  stamp.hidden = false;
  $('tells').replaceChildren(...tells.map(t => Object.assign(document.createElement('li'), { textContent: t })));
  const last = $('history').lastElementChild;
  if (last) last.dataset.verdict = VERDICT[verdict];
}

function showReport(report, results) {
  $('report').hidden = false;
  $('report-title').textContent = report.title;
  $('report-text').textContent = report.say;
  const honesty = Math.round(100 - results.reduce((s, r) => s + r.stress, 0) / Math.max(1, results.length));
  $('honesty').textContent = `${honesty}%`;
  $('honesty-bar').style.width = `${honesty}%`;

  // Exhibit A: the guiltiest face of the night.
  const worst = results.filter(r => r.snap).sort((a, b) => b.stress - a.stress)[0];
  $('exhibit').hidden = !worst;
  if (worst) {
    const photo = $('exhibit-photo');
    photo.width = worst.snap.width;
    photo.height = worst.snap.height;
    photo.getContext('2d').drawImage(worst.snap, 0, 0);
    $('exhibit-stamp').className = `stamp ${worst.verdict}`;
    $('exhibit-stamp').textContent = VERDICT[worst.verdict];
    $('exhibit-caption').textContent = `Exhibit A: the face when asked "${worst.question}"`;
  }

  const rows = results.map(r => {
    const tr = document.createElement('tr');
    const question = r.followup ? `↳ ${r.question}` : r.question;
    const cells = [question, r.answer || '(silence)', `${VERDICT[r.verdict]} · ${r.stress}`, r.tells.join(', ')];
    for (const text of cells) tr.append(Object.assign(document.createElement('td'), { textContent: text }));
    tr.className = r.verdict;
    return tr;
  });
  $('report-table').replaceChildren(...rows);
  $('report').scrollIntoView({ behavior: 'smooth' });
}

function addHistory(question, answer) {
  const li = document.createElement('li');
  li.append(Object.assign(document.createElement('b'), { textContent: question }), ` ${answer || '(silence)'}`);
  $('history').append(li);
}

function setPhase(text) {
  $('phase').textContent = text;
}

function setTitle(text) {
  if (text) $('title').textContent = `Suspect profile: ${text}`;
}

function setStatus(text) {
  $('status').textContent = text;
}

function pick(list, n) {
  return [...list].sort(() => Math.random() - 0.5).slice(0, n);
}
