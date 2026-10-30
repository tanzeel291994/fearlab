// Voice pitch and loudness from the Mac microphone, sampled 10 times a second.
// Pitch rising and voices getting quieter are classic TV-polygraph "tells".

const MIN_HZ = 75;
const MAX_HZ = 400;

export class VoiceAnalyzer {
  level = 0; // RMS of the latest sample
  pitch = null; // Hz of the latest voiced sample
  #ctx = null;
  #analyser = null;
  #buf = null;
  #window = null;

  // Needs a user gesture (button click) for the AudioContext to start.
  async start() {
    if (this.#ctx) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    this.#ctx = new AudioContext();
    this.#analyser = this.#ctx.createAnalyser();
    this.#analyser.fftSize = 2048;
    this.#ctx.createMediaStreamSource(stream).connect(this.#analyser);
    this.#buf = new Float32Array(this.#analyser.fftSize);
    setInterval(() => this.#sample(), 100);
  }

  startWindow() {
    this.#window = { pitches: [], levels: [] };
  }

  current() {
    const w = this.#window;
    if (!w || !w.pitches.length) return { pitch: null, level: null };
    return { pitch: median(w.pitches), level: w.levels.reduce((a, b) => a + b, 0) / w.levels.length };
  }

  endWindow() {
    const result = this.current();
    this.#window = null;
    return result;
  }

  #sample() {
    this.#analyser.getFloatTimeDomainData(this.#buf);
    const buf = this.#buf;
    let energy = 0;
    for (const x of buf) energy += x * x;
    this.level = Math.sqrt(energy / buf.length);
    this.pitch = this.level > 0.01 ? detectPitch(buf, energy, this.#ctx.sampleRate) : null;
    if (this.#window && this.pitch) {
      this.#window.pitches.push(this.pitch);
      this.#window.levels.push(this.level);
    }
  }
}

// Autocorrelation pitch detection: finds the lag where the signal best matches itself.
function detectPitch(buf, energy, sampleRate) {
  const minLag = Math.floor(sampleRate / MAX_HZ);
  const maxLag = Math.floor(sampleRate / MIN_HZ);
  let bestLag = -1;
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < buf.length - lag; i++) corr += buf[i] * buf[i + lag];
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  if (bestLag < 0 || bestCorr / energy < 0.3) return null; // not clearly voiced
  return sampleRate / bestLag;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
