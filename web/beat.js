// A tiny built-in dance beat (Web Audio), so the game controls when the music
// stops for Freeze Dance. No audio files or licences needed.

const BPM = 116;
const STEP = 60 / BPM / 2; // eighth notes
const BASS = [55, 55, 65.4, 55, 73.4, 73.4, 65.4, 49]; // A, C, D, G-ish groove

export class Beat {
  #ctx = null;
  #out = null;
  #timer = null;
  #step = 0;
  #nextTime = 0;

  start() {
    this.#ctx ??= new AudioContext();
    const ctx = this.#ctx;
    ctx.resume();
    this.#out = ctx.createGain();
    this.#out.gain.value = 0.6;
    this.#out.connect(ctx.destination);
    this.#nextTime = ctx.currentTime + 0.05;
    this.#step = 0;
    clearInterval(this.#timer);
    this.#timer = setInterval(() => this.#schedule(), 25);
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
    if (this.#out) {
      const out = this.#out;
      out.gain.setTargetAtTime(0, this.#ctx.currentTime, 0.03);
      setTimeout(() => out.disconnect(), 300);
      this.#out = null;
    }
  }

  get playing() {
    return this.#timer !== null;
  }

  #schedule() {
    while (this.#nextTime < this.#ctx.currentTime + 0.12) {
      const t = this.#nextTime;
      const s = this.#step % 16;
      if (s % 4 === 0) this.#kick(t);
      if (s % 8 === 4) this.#clap(t);
      this.#hat(t, s % 2 ? 0.05 : 0.09);
      if (s % 2 === 0) this.#bass(t, BASS[(s / 2) % BASS.length]);
      this.#nextTime += STEP;
      this.#step++;
    }
  }

  #kick(t) {
    const ctx = this.#ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    gain.gain.setValueAtTime(1, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(gain).connect(this.#out);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  #noise(t, length, filterFreq, volume) {
    const ctx = this.#ctx;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + length);
    src.connect(filter).connect(gain).connect(this.#out);
    src.start(t);
  }

  #clap(t) {
    this.#noise(t, 0.2, 1200, 0.5);
  }

  #hat(t, volume) {
    this.#noise(t, 0.05, 7000, volume);
  }

  #bass(t, freq) {
    const ctx = this.#ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq * 2;
    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + STEP * 1.8);
    osc.connect(gain).connect(this.#out);
    osc.start(t);
    osc.stop(t + STEP * 2);
  }
}
