import { HeartRateMonitor, SimulatedHeartRate } from './heart.js';
import { LieDetector } from './lie-detector.js';

const $ = id => document.getElementById(id);
const ui = {
  status: $('status'), bpm: $('bpm'), heart: $('heart'), baseline: $('baseline'),
  chart: $('chart'), connect: $('connect'), demo: $('demo'), disconnect: $('disconnect'),
  fakeSpike: $('fake-spike'), answer: $('answer'), verdict: $('verdict'), unsupported: $('unsupported'),
};

const VERDICT_TEXT = {
  busted: '🚨 BUSTED! That heart did NOT like that question.',
  suspicious: '🤨 Suspicious… the heart says there\'s more to this story.',
  hmm: '🧐 A little flutter. We\'ll allow it. For now.',
  cool: '😎 Ice cold. Either honest or a professional liar.',
};

const detector = new LieDetector();
let source = null;

if (!HeartRateMonitor.supported) {
  ui.unsupported.hidden = false;
  ui.connect.disabled = true;
}

ui.connect.onclick = async () => {
  const monitor = new HeartRateMonitor();
  attach(monitor);
  try {
    await monitor.connect();
  } catch (err) {
    monitor.disconnect(); // resets the UI via the 'disconnected' status
    // NotFoundError = user closed the picker
    if (err.name !== 'NotFoundError') setStatus('disconnected', `Failed: ${err.message}`);
  }
};

ui.demo.onclick = () => {
  const sim = new SimulatedHeartRate();
  attach(sim);
  sim.connect();
  ui.fakeSpike.hidden = false;
};

ui.disconnect.onclick = () => source?.disconnect();
ui.fakeSpike.onclick = () => source?.spike?.();

ui.answer.onclick = () => {
  if (!detector.answering) {
    detector.startAnswer();
    ui.answer.textContent = 'Stop answer';
    ui.verdict.hidden = true;
    return;
  }
  const result = detector.endAnswer();
  ui.answer.textContent = 'Start answer';
  ui.verdict.hidden = false;
  ui.verdict.className = `verdict ${result.verdict}`;
  ui.verdict.textContent =
    `${VERDICT_TEXT[result.verdict]}  (${result.reference} → ${result.peak} BPM, +${Math.max(0, result.jump)})`;
};

function attach(next) {
  source?.disconnect();
  source = next;
  source.addEventListener('status', e => {
    const { state, name } = e.detail;
    const label = { connecting: 'Connecting…', connected: name || 'Connected',
      reconnecting: 'Reconnecting…', disconnected: 'Not connected' }[state];
    setStatus(state, label);
    const live = state !== 'disconnected';
    ui.connect.hidden = ui.demo.hidden = live;
    ui.disconnect.hidden = !live;
    if (!live) detach();
  });
  source.addEventListener('reading', e => onReading(e.detail));
}

function detach() {
  source = null;
  ui.fakeSpike.hidden = true;
  ui.answer.disabled = true;
  ui.heart.classList.remove('beat');
}

function setStatus(state, label) {
  ui.status.className = `pill ${state}`;
  ui.status.textContent = label;
}

function onReading(reading) {
  if (!reading.bpm || reading.contact === false) {
    ui.bpm.textContent = '--';
    ui.baseline.textContent = 'No skin contact — is the band on?';
    return;
  }
  detector.add(reading);
  ui.bpm.textContent = reading.bpm;
  ui.heart.style.setProperty('--beat', `${60 / reading.bpm}s`);
  ui.heart.classList.add('beat');
  ui.answer.disabled = false;
  const base = detector.baseline;
  ui.baseline.textContent = base ? `Baseline: ${Math.round(base)} BPM` : 'Baseline: warming up…';
  drawChart(base);
}

function drawChart(baseline) {
  const canvas = ui.chart;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const points = detector.readings;
  if (points.length < 2) return;
  const now = Date.now(), span = 120_000;
  const bpms = points.map(p => p.bpm);
  const lo = Math.min(...bpms, baseline ?? Infinity) - 5;
  const hi = Math.max(...bpms, baseline ?? -Infinity) + 5;
  const x = t => w - ((now - t) / span) * w;
  const y = b => h - ((b - lo) / (hi - lo)) * h;

  if (baseline) {
    ctx.strokeStyle = '#9a90a8';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y(baseline));
    ctx.lineTo(w, y(baseline));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = '#ff3b5c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(x(p.time), y(p.bpm)) : ctx.moveTo(x(p.time), y(p.bpm))));
  ctx.stroke();
}
