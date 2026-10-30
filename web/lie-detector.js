// Turns a heart-rate stream into game moments. This is a party gag, not a real
// lie detector — laughing raises heart rate just as much as lying does.

const median = xs => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export class LieDetector {
  #readings = []; // { bpm, time }
  #window = null;

  add({ bpm, time }) {
    if (!bpm) return; // 0 = band not reading (off wrist)
    this.#readings.push({ bpm, time });
    const cutoff = time - 120_000;
    while (this.#readings[0].time < cutoff) this.#readings.shift();
    if (this.#window) this.#window.peak = Math.max(this.#window.peak, this.#smoothed());
  }

  get readings() {
    return this.#readings;
  }

  // Resting level: median of the last minute, ignoring the most recent 10s.
  get baseline() {
    const now = Date.now();
    return median(
      this.#readings.filter(r => r.time > now - 60_000 && r.time < now - 10_000).map(r => r.bpm),
    );
  }

  get current() {
    return this.#smoothed();
  }

  // Call when the question is asked; call endAnswer() when they finish answering.
  startAnswer() {
    const start = this.#smoothed() ?? 0;
    this.#window = { start, baseline: this.baseline ?? start, peak: start };
  }

  endAnswer() {
    const w = this.#window;
    this.#window = null;
    if (!w) return null;
    const reference = Math.min(w.start, w.baseline);
    const jump = Math.round(w.peak - reference);
    return { reference: Math.round(reference), peak: Math.round(w.peak), jump, verdict: verdictFor(jump) };
  }

  get answering() {
    return this.#window !== null;
  }

  #smoothed() {
    const last = this.#readings.slice(-3);
    return last.length ? last.reduce((s, r) => s + r.bpm, 0) / last.length : null;
  }
}

function verdictFor(jump) {
  if (jump >= 20) return 'busted';
  if (jump >= 10) return 'suspicious';
  if (jump >= 5) return 'hmm';
  return 'cool';
}
