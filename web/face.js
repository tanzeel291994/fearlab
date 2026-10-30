import { loadFaceLandmarker, startCamera, eachFrame, drawMirrored } from './vision.js';
import { speak } from './voice.js';
import { CHALLENGES, toScores, scoreFace, jokeFor } from './expressions.js';

const MAX_FACES = 4;
const COUNTDOWN_MS = 3000;
const ROUND_MS = 5000;
const COLORS = ['#ff3b5c', '#3ddc97', '#ffb020', '#5ab4ff'];

const $ = id => document.getElementById(id);
const video = $('video');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

let landmarker;
let challengeKey = 'monster';
let round = null; // { phase: 'countdown' | 'capture', startedAt, best: [{ score, snap }] }

renderChallengePicker();
init().catch(err => {
  console.error(err);
  setStatus(err.name === 'NotAllowedError' ? 'Camera blocked — allow it in Chrome' : `Error: ${err.message}`);
});

async function init() {
  setStatus('Loading face model…');
  landmarker = await loadFaceLandmarker(MAX_FACES);
  setStatus('Starting camera…');
  await startCamera(video, canvas);
  setStatus('Ready');
  $('start').disabled = false;
  eachFrame(video, onFrame);
}

function onFrame(t) {
  const result = landmarker.detectForVideo(video, t);
  const challenge = CHALLENGES[challengeKey];
  // Players are numbered left to right as they appear on screen.
  const faces = result.faceLandmarks
    .map((landmarks, i) => {
      const shapes = toScores(result.faceBlendshapes[i]);
      return { box: boxOf(landmarks), shapes, score: scoreFace(challenge, shapes) };
    })
    .sort((a, b) => a.box.x - b.box.x);

  drawMirrored(ctx, video);
  updateRound(faces); // snapshots come from the clean frame, before overlays
  drawOverlays(faces);
  if ($('debug').checked) renderDebug(faces[0]);
}

// Bounding box in canvas pixels, mirrored to match the selfie view.
function boxOf(landmarks) {
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const p of landmarks) {
    const x = 1 - p.x;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = canvas.width, h = canvas.height;
  return { x: minX * w, y: minY * h, w: (maxX - minX) * w, h: (maxY - minY) * h };
}

function drawOverlays(faces) {
  const capturing = round?.phase === 'capture';
  faces.forEach((f, i) => {
    const color = COLORS[i % COLORS.length];
    const { x, y, w, h } = f.box;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, w, h);

    // Live meter under the face
    const barY = y + h + 10;
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(x, barY, w, 14);
    ctx.fillStyle = color;
    ctx.fillRect(x, barY, (w * f.score) / 100, 14);

    ctx.font = 'bold 28px system-ui, sans-serif';
    ctx.fillStyle = color;
    const best = capturing ? round.best[i]?.score ?? 0 : null;
    const label = best === null ? `P${i + 1}  ${f.score}` : `P${i + 1}  ${f.score}  (best ${best})`;
    ctx.fillText(label, x, y - 12);
  });

  if (!round) return;
  const elapsed = performance.now() - round.startedAt;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 8;
  if (round.phase === 'countdown') {
    const n = String(Math.max(1, Math.ceil((COUNTDOWN_MS - elapsed) / 1000)));
    ctx.font = 'bold 220px system-ui, sans-serif';
    ctx.strokeText(n, canvas.width / 2, canvas.height / 2 + 80);
    ctx.fillText(n, canvas.width / 2, canvas.height / 2 + 80);
  } else {
    const left = Math.max(0, (ROUND_MS - elapsed) / 1000).toFixed(1);
    ctx.font = 'bold 72px system-ui, sans-serif';
    ctx.strokeText(`GO! ${left}s`, canvas.width / 2, 90);
    ctx.fillText(`GO! ${left}s`, canvas.width / 2, 90);
  }
  ctx.textAlign = 'start';
}

function updateRound(faces) {
  if (!round) return;
  const elapsed = performance.now() - round.startedAt;
  if (round.phase === 'countdown') {
    if (elapsed >= COUNTDOWN_MS) round = { ...round, phase: 'capture', startedAt: performance.now() };
    return;
  }
  faces.forEach((f, i) => {
    const best = (round.best[i] ??= { score: -1, snap: document.createElement('canvas') });
    if (f.score > best.score) {
      best.score = f.score;
      snapshot(best.snap, f.box);
    }
  });
  if (elapsed >= ROUND_MS) finishRound();
}

function snapshot(target, box) {
  const pad = 0.35;
  const size = Math.max(box.w, box.h) * (1 + pad * 2);
  const sx = Math.max(0, box.x + box.w / 2 - size / 2);
  const sy = Math.max(0, box.y + box.h / 2 - size / 2);
  target.width = target.height = 320;
  target.getContext('2d').drawImage(canvas, sx, sy, size, size, 0, 0, 320, 320);
}

function startRound() {
  round = { phase: 'countdown', startedAt: performance.now(), best: [] };
  $('results').replaceChildren();
  $('start').disabled = true;
}

function finishRound() {
  const players = round.best
    .map((b, i) => ({ ...b, player: i + 1 }))
    .filter(p => p.score >= 0)
    .sort((a, b) => b.score - a.score);
  round = null;
  $('start').disabled = false;

  if (!players.length) {
    $('results').textContent = 'Nobody showed up on camera! Try again.';
    return;
  }

  const lines = [];
  const cards = players.map((p, rank) => {
    const joke = jokeFor(challengeKey, p.score);
    lines.push(players.length > 1 ? `Player ${p.player}: ${p.score} points. ${joke}` : `${p.score} points! ${joke}`);
    const card = document.createElement('div');
    card.className = 'card';
    card.style.borderColor = COLORS[(p.player - 1) % COLORS.length];
    const crown = rank === 0 && players.length > 1 ? '👑 ' : '';
    card.innerHTML = `<div class="score">${crown}P${p.player} · ${p.score}</div><p></p>`;
    card.querySelector('p').textContent = joke;
    card.prepend(p.snap);
    return card;
  });
  $('results').replaceChildren(...cards);
  if ($('speak').checked) speak(lines.join(' '), { voice: 'kids' });
}

function renderChallengePicker() {
  const buttons = Object.entries(CHALLENGES).map(([key, c]) => {
    const b = document.createElement('button');
    b.textContent = `${c.emoji} ${c.title}`;
    b.onclick = () => selectChallenge(key);
    b.dataset.key = key;
    return b;
  });
  $('challenges').replaceChildren(...buttons);
  selectChallenge(challengeKey);
}

function selectChallenge(key) {
  if (round) return;
  challengeKey = key;
  for (const b of $('challenges').children) b.classList.toggle('selected', b.dataset.key === key);
  $('prompt').textContent = CHALLENGES[key].prompt;
}

function renderDebug(face) {
  const panel = $('debug-panel');
  panel.hidden = false;
  if (!face) {
    panel.textContent = 'No face';
    return;
  }
  const top = Object.entries(face.shapes)
    .filter(([name]) => name !== '_neutral')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  panel.innerHTML = top
    .map(([name, v]) => `<div class="row"><span>${name}</span><div class="bar"><i style="width:${v * 100}%"></i></div><span>${v.toFixed(2)}</span></div>`)
    .join('');
}

function setStatus(text) {
  $('status').textContent = text;
  $('status').className = `pill ${text === 'Ready' ? 'connected' : ''}`;
}

$('start').onclick = startRound;
$('debug').onchange = e => { if (!e.target.checked) $('debug-panel').hidden = true; };
