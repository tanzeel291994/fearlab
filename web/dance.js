import { loadPoseLandmarker, startCamera, eachFrame, drawMirrored } from './vision.js';
import { speak, preload } from './voice.js';
import { Beat } from './beat.js';

const MAX_PLAYERS = 4;
const COUNTDOWN_MS = 4000;
const FREEZE_MS = 3000;
const FREEZE_GRACE_MS = 600; // reaction time before wobbling counts
const COLORS = ['#ff3b5c', '#3ddc97', '#ffb020', '#5ab4ff'];

// MediaPipe pose landmark indices
const NOSE = 0, L_SHOULDER = 11, R_SHOULDER = 12, L_WRIST = 15, R_WRIST = 16;
const L_HIP = 23, R_HIP = 24, L_KNEE = 25, R_KNEE = 26, L_ANKLE = 27, R_ANKLE = 28;
const TRACKED = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

const MODES = {
  danceoff: {
    title: '🕺 Dance Off', freeze: false,
    prompt: 'Biggest, bravest moves win! Jumps, hands up, star jumps and squats get bonus points.',
    intro: 'Dance off! Show me your biggest, bravest moves. Jumps and hands in the air get bonus points!',
  },
  freeze: {
    title: '🧊 Freeze Dance', freeze: true,
    prompt: 'Dance like crazy, but when the music stops, FREEZE like a statue!',
    intro: 'Freeze dance! Dance like crazy, but when the music stops, freeze like a statue!',
  },
};

const MOVES = {
  jump: { label: 'JUMP!', points: 10 },
  hands: { label: 'HANDS UP!', points: 5 },
  star: { label: 'STAR!', points: 8 },
  squat: { label: 'LOW DOWN!', points: 6 },
};

const AWARDS = [
  { name: 'Super Kangaroo', stat: p => p.moves.jump * 2 },
  { name: 'Hands-Up Hero', stat: p => p.moves.hands * 1.5 },
  { name: 'Star Power', stat: p => p.moves.star * 2 },
  { name: 'Low-Down Legend', stat: p => p.moves.squat * 2 },
  { name: 'Statue Master', stat: p => p.statue / 2 },
  { name: 'Wiggle Wizard', stat: p => p.motion / 15 },
];

const LINES = {
  go: 'Three, two, one, dance!',
  freeze: 'Freeze!',
  dance: 'Dance!',
  stop: 'Time is up! Let us see the scores.',
};

const $ = id => document.getElementById(id);
const video = $('video');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const beat = new Beat();

let landmarker;
let modeKey = 'danceoff';
let game = null; // { phase, startedAt, players[], freezeUntil, nextFreezeAt, popups[] }

renderModes();
init().catch(err => {
  console.error(err);
  $('status').textContent = err.name === 'NotAllowedError' ? 'Camera blocked: allow it in Chrome' : `Error: ${err.message}`;
});

async function init() {
  $('status').textContent = 'Loading body tracker…';
  landmarker = await loadPoseLandmarker(MAX_PLAYERS);
  await startCamera(video, canvas);
  $('status').textContent = 'Ready';
  $('status').className = 'pill connected';
  $('start').disabled = false;
  // Fetch the fixed voice lines up front so they play instantly (and are cached for free next time).
  for (const text of [...Object.values(LINES), ...Object.values(MODES).map(m => m.intro)]) preload(text, 'kids');
  eachFrame(video, onFrame);
}

function onFrame(t) {
  const result = landmarker.detectForVideo(video, t);
  const W = canvas.width, H = canvas.height;
  // Mirrored pixel coordinates. Keep the N biggest (closest) bodies so the audience
  // in the background isn't scored, then number dancers left to right.
  const poses = result.landmarks
    .map(lms => lms.map(l => ({ x: (1 - l.x) * W, y: l.y * H, v: l.visibility ?? 1 })))
    .sort((a, b) => torso(b) - torso(a))
    .slice(0, dancerCount())
    .sort((a, b) => a[NOSE].x - b[NOSE].x);

  drawMirrored(ctx, video);
  if (game?.phase === 'playing') updateGame(poses, t);
  else if (game?.phase === 'countdown' && t - game.startedAt >= COUNTDOWN_MS) beginPlaying(t);
  drawPoses(poses);
  drawHud(t);
  if (game?.phase !== 'playing') drawDancersInView(poses.length);
}

function roundSeconds() {
  return Number($('seconds').value);
}

function dancerCount() {
  return Number($('players').value);
}

function drawDancersInView(seen) {
  const wanted = dancerCount();
  const text = seen >= wanted ? `All ${wanted} dancer${wanted > 1 ? 's' : ''} ready!` : `Dancers in view: ${seen} of ${wanted}`;
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = seen >= wanted ? '#3ddc97' : '#ffb020';
  ctx.strokeText(text, canvas.width / 2, canvas.height - 30);
  ctx.fillText(text, canvas.width / 2, canvas.height - 30);
  ctx.textAlign = 'start';
}

// ---------------------------------------------------------------- game loop

$('start').onclick = async () => {
  const mode = MODES[modeKey];
  $('start').disabled = $('players').disabled = $('seconds').disabled = true;
  $('results').replaceChildren();
  game = { phase: 'intro', players: [], popups: [] };
  await speak(mode.intro, { voice: 'kids' });
  game.phase = 'countdown';
  game.startedAt = performance.now();
  speak(LINES.go, { voice: 'kids' });
};

function beginPlaying(t) {
  game.phase = 'playing';
  game.startedAt = t;
  game.lastT = t;
  game.freezeUntil = 0;
  game.nextFreezeAt = MODES[modeKey].freeze ? t + randomBetween(3000, 6000) : Infinity;
  if ($('music').checked) beat.start();
}

function updateGame(poses, t) {
  const dt = Math.min(0.1, (t - game.lastT) / 1000);
  game.lastT = t;

  // Freeze Dance: the beat stops at random moments.
  if (t >= game.nextFreezeAt) {
    game.freezeUntil = t + FREEZE_MS;
    game.freezeStarted = t;
    game.nextFreezeAt = t + FREEZE_MS + randomBetween(3000, 6000);
    beat.stop();
    speak(LINES.freeze, { voice: 'kids' });
  } else if (game.freezeUntil && t >= game.freezeUntil) {
    game.freezeUntil = 0;
    if ($('music').checked) beat.start();
    speak(LINES.dance, { voice: 'kids' });
  }
  const frozen = game.freezeUntil > 0;
  const graceOver = frozen && t - game.freezeStarted > FREEZE_GRACE_MS;

  poses.forEach((pose, i) => {
    const p = (game.players[i] ??= newPlayer(i));
    const speed = bodySpeed(pose, p.prev, dt);
    p.prev = pose;
    if (speed === null) return;

    if (frozen) {
      if (!graceOver) return;
      if (speed > 0.6) {
        p.points = Math.max(0, p.points - speed * dt * 10);
        popup(p, pose, 'WOBBLE!', '#5ab4ff', t, 'wobble');
      } else {
        p.statue += dt;
        p.points += 4 * dt;
      }
      return;
    }

    const movePoints = Math.min(speed, 4) * 3 * dt;
    p.points += movePoints;
    p.motion += movePoints;
    for (const move of detectMoves(pose, p, t)) {
      p.moves[move]++;
      p.points += MOVES[move].points;
      popup(p, pose, `${MOVES[move].label} +${MOVES[move].points}`, COLORS[i], t, move);
    }
  });

  if (t - game.startedAt >= roundSeconds() * 1000) finish();
}

function newPlayer(i) {
  return {
    n: i + 1, points: 0, motion: 0, statue: 0, prev: null,
    moves: { jump: 0, hands: 0, star: 0, squat: 0 },
    poses: { hands: false, star: false, squat: false }, hips: [], cooldown: {},
  };
}

// Average landmark speed in torso-lengths per second, so near and far dancers score fairly.
function bodySpeed(pose, prev, dt) {
  if (!prev || dt <= 0) return null;
  const size = torso(pose);
  let total = 0, count = 0;
  for (const i of TRACKED) {
    if (pose[i].v < 0.5 || prev[i].v < 0.5) continue;
    total += Math.hypot(pose[i].x - prev[i].x, pose[i].y - prev[i].y);
    count++;
  }
  if (count < 4) return null;
  const perFrame = total / count / size;
  if (perFrame > 1) return null; // dancers swapped places: ignore this frame
  return perFrame / dt;
}

function detectMoves(pose, p, t) {
  const found = [];
  const size = torso(pose);
  const seen = (...ids) => ids.every(i => pose[i].v > 0.5);
  const shoulderWidth = Math.abs(pose[L_SHOULDER].x - pose[R_SHOULDER].x) || size * 0.6;
  const hipY = (pose[L_HIP].y + pose[R_HIP].y) / 2;

  // Pose moves count when you go *into* the pose, not for holding it.
  const edge = (name, active) => {
    if (active && !p.poses[name] && !(t < (p.cooldown[name] ?? 0))) {
      found.push(name);
      p.cooldown[name] = t + 700;
    }
    p.poses[name] = active;
  };

  if (seen(NOSE, L_WRIST, R_WRIST)) {
    edge('hands', pose[L_WRIST].y < pose[NOSE].y && pose[R_WRIST].y < pose[NOSE].y);
  }
  if (seen(L_WRIST, R_WRIST, L_ANKLE, R_ANKLE)) {
    edge('star', Math.abs(pose[L_WRIST].x - pose[R_WRIST].x) > shoulderWidth * 2.6
      && Math.abs(pose[L_ANKLE].x - pose[R_ANKLE].x) > shoulderWidth * 1.4);
  }
  if (seen(L_HIP, R_HIP, L_KNEE, R_KNEE)) {
    const kneeY = (pose[L_KNEE].y + pose[R_KNEE].y) / 2;
    edge('squat', kneeY - hipY < size * 0.35);
  }

  // Jump: hips and ankles both shoot up quickly.
  if (seen(L_HIP, R_HIP, L_ANKLE, R_ANKLE)) {
    const ankleY = (pose[L_ANKLE].y + pose[R_ANKLE].y) / 2;
    p.hips = p.hips.filter(h => t - h.t < 350);
    p.hips.push({ t, hipY, ankleY });
    const lowestHip = Math.max(...p.hips.map(h => h.hipY));
    const lowestAnkle = Math.max(...p.hips.map(h => h.ankleY));
    const airborne = lowestHip - hipY > size * 0.25 && lowestAnkle - ankleY > size * 0.15;
    if (airborne && !(t < (p.cooldown.jump ?? 0))) {
      found.push('jump');
      p.cooldown.jump = t + 800;
    }
  }
  return found;
}

function torso(pose) {
  const sx = (pose[L_SHOULDER].x + pose[R_SHOULDER].x) / 2, sy = (pose[L_SHOULDER].y + pose[R_SHOULDER].y) / 2;
  const hx = (pose[L_HIP].x + pose[R_HIP].x) / 2, hy = (pose[L_HIP].y + pose[R_HIP].y) / 2;
  return Math.hypot(sx - hx, sy - hy) || 100;
}

async function finish() {
  beat.stop();
  const players = game.players.filter(Boolean).map(p => ({ ...p, points: Math.round(p.points) }));
  game = null;
  $('start').disabled = $('players').disabled = $('seconds').disabled = false;
  if (!players.length) {
    $('results').textContent = 'Nobody was on camera! Step back so it can see your whole body.';
    return;
  }
  players.sort((a, b) => b.points - a.points);
  players.forEach(p => (p.award = bestAward(p)));
  renderResults(players);

  await speak(LINES.stop, { voice: 'kids' });
  const champion = players[0];
  const lines = [players.length > 1 ? `Player ${champion.n} is the dance champion!` : 'What a superstar dancer!'];
  for (const p of players) lines.push(players.length > 1 ? `Player ${p.n}, you are the ${p.award}!` : `You are the ${p.award}!`);
  for (const line of lines) await speak(line, { voice: 'kids' });
}

function bestAward(p) {
  const awards = MODES[modeKey].freeze ? AWARDS : AWARDS.filter(a => a.name !== 'Statue Master');
  return awards.reduce((best, a) => (a.stat(p) > best.stat(p) ? a : best)).name;
}

// ---------------------------------------------------------------- drawing

function popup(p, pose, text, color, t, key) {
  if (t < (p.cooldown[`popup-${key}`] ?? 0)) return;
  p.cooldown[`popup-${key}`] = t + 900;
  game.popups.push({ text, color, x: pose[NOSE].x, y: pose[NOSE].y - 60, t });
}

function drawPoses(poses) {
  poses.forEach((pose, i) => {
    const color = COLORS[i % COLORS.length];
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    for (const [a, b] of BONES) {
      if (pose[a].v < 0.5 || pose[b].v < 0.5) continue;
      ctx.beginPath();
      ctx.moveTo(pose[a].x, pose[a].y);
      ctx.lineTo(pose[b].x, pose[b].y);
      ctx.stroke();
    }
    const points = game?.players[i] ? Math.round(game.players[i].points) : null;
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(points === null ? `P${i + 1}` : `P${i + 1} · ${points}`, pose[NOSE].x, pose[NOSE].y - 110);
    ctx.textAlign = 'start';
  });
}

function drawHud(t) {
  if (!game) return;
  const W = canvas.width, H = canvas.height;
  ctx.textAlign = 'center';
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#000';
  ctx.fillStyle = '#fff';

  if (game.phase === 'countdown') {
    const n = String(Math.max(1, Math.ceil((COUNTDOWN_MS - (t - game.startedAt)) / 1000)));
    ctx.font = 'bold 240px system-ui, sans-serif';
    ctx.strokeText(n, W / 2, H / 2 + 80);
    ctx.fillText(n, W / 2, H / 2 + 80);
  }

  if (game.phase === 'playing') {
    const total = roundSeconds() * 1000;
    const left = Math.max(0, total - (t - game.startedAt));
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(0, 0, W, 16);
    ctx.fillStyle = '#ff3b5c';
    ctx.fillRect(0, 0, (W * left) / total, 16);

    if (game.freezeUntil) {
      ctx.fillStyle = 'rgba(90,180,255,.25)';
      ctx.fillRect(0, 0, W, H);
      ctx.font = 'bold 160px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.strokeText('FREEZE!', W / 2, H / 2);
      ctx.fillText('FREEZE!', W / 2, H / 2);
    }
  }

  // Floating move labels
  game.popups = game.popups.filter(p => t - p.t < 1000);
  ctx.font = 'bold 44px system-ui, sans-serif';
  for (const p of game.popups) {
    const age = (t - p.t) / 1000;
    ctx.globalAlpha = 1 - age;
    ctx.fillStyle = p.color;
    ctx.strokeText(p.text, p.x, p.y - age * 80);
    ctx.fillText(p.text, p.x, p.y - age * 80);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'start';
}

function renderResults(players) {
  const cards = players.map((p, rank) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.borderColor = COLORS[(p.n - 1) % COLORS.length];
    const medal = ['🥇', '🥈', '🥉', '🎉'][rank] ?? '🎉';
    card.innerHTML = `
      <div class="score">${medal} P${p.n} · ${p.points}</div>
      <p class="award"></p>
      <p class="muted small">Jumps ${p.moves.jump} · Hands up ${p.moves.hands} · Stars ${p.moves.star} · Squats ${p.moves.squat}${
        MODES[modeKey].freeze ? ` · Statue ${Math.round(p.statue)}s` : ''}</p>`;
    card.querySelector('.award').textContent = `🏆 ${p.award}`;
    return card;
  });
  $('results').replaceChildren(...cards);
}

function renderModes() {
  const buttons = Object.entries(MODES).map(([key, m]) => {
    const b = document.createElement('button');
    b.textContent = m.title;
    b.dataset.key = key;
    b.onclick = () => selectMode(key);
    return b;
  });
  $('modes').replaceChildren(...buttons);
  selectMode(modeKey);
}

function selectMode(key) {
  if (game) return;
  modeKey = key;
  for (const b of $('modes').children) b.classList.toggle('selected', b.dataset.key === key);
  $('prompt').textContent = MODES[key].prompt;
}

function randomBetween(a, b) {
  return a + Math.random() * (b - a);
}
