// Turns heart rate, face cues, voice and words into a party-grade "stress" score.
// Calibration and warm-up answers set each player's personal baseline; hot-seat
// answers are compared against it. A gag, not science: laughing looks exactly like lying.

const clamp01 = x => Math.max(0, Math.min(1, x));
const avg = (shapes, ...names) => names.reduce((s, n) => s + (shapes[n] ?? 0), 0) / names.length;

const HEDGES = /\b(honestly|to be honest|truthfully|i swear|believe me|trust me|technically|i would never|of course not|absolutely not)\b/i;
const FILLERS = /\b(um+|uh+|erm+|hmm+|uh-huh|you know|i mean)\b/gi;
const DENIAL = /^(no|nope|never|nah|not really|no way)\b/i;

export class PolygraphSensors {
  #hr = []; // recent { bpm, time }
  #window = null;
  #calibration = [];
  voice = null; // optional VoiceAnalyzer

  addHeart({ bpm, time }) {
    if (!bpm) return;
    this.#hr.push({ bpm, time });
    if (this.#hr.length > 120) this.#hr.shift();
    if (this.#window) this.#window.hrPeak = Math.max(this.#window.hrPeak ?? 0, this.#recentBpm());
  }

  addFace(shapes) {
    const w = this.#window;
    if (!w) return;
    w.frames++;
    const blink = avg(shapes, 'eyeBlinkLeft', 'eyeBlinkRight') > 0.5;
    if (blink && !w.eyesClosed) w.blinks++;
    w.eyesClosed = blink;
    const look = Math.max(
      avg(shapes, 'eyeLookOutLeft', 'eyeLookInRight'), // looking right
      avg(shapes, 'eyeLookInLeft', 'eyeLookOutRight'), // looking left
      avg(shapes, 'eyeLookUpLeft', 'eyeLookUpRight'),
    );
    if (look > 0.5) w.gazeAway++;
    w.tension += Math.max(avg(shapes, 'mouthPressLeft', 'mouthPressRight'), shapes.mouthRollLower ?? 0)
      + avg(shapes, 'browDownLeft', 'browDownRight');
    // "Duping delight": a smile, or a lopsided half-smile, while answering.
    const smile = avg(shapes, 'mouthSmileLeft', 'mouthSmileRight');
    const lopsided = Math.abs((shapes.mouthSmileLeft ?? 0) - (shapes.mouthSmileRight ?? 0));
    if (smile > 0.35 || lopsided > 0.2) w.smirk++;
  }

  get bpm() {
    return this.#recentBpm();
  }

  get hasHeart() {
    return this.#hr.length > 0 && Date.now() - this.#hr.at(-1).time < 5000;
  }

  // Call right after the question has been read out.
  startAnswer() {
    const bpm = this.#recentBpm();
    this.#window = {
      startedAt: performance.now(), hrStart: bpm, hrPeak: bpm,
      frames: 0, blinks: 0, eyesClosed: false, gazeAway: 0, tension: 0, smirk: 0,
    };
    this.voice?.startWindow();
  }

  // Reading so far (used live for the needle, and at the end of the answer).
  current(firstWordAt = null) {
    const w = this.#window;
    if (!w) return null;
    const seconds = Math.max(0.5, (performance.now() - w.startedAt) / 1000);
    const voice = this.voice?.current() ?? { pitch: null, level: null };
    return {
      seconds,
      hrJump: w.hrStart ? Math.round(w.hrPeak - w.hrStart) : null,
      hrPeak: w.hrPeak ? Math.round(w.hrPeak) : null,
      blinksPerMin: Math.round((w.blinks / seconds) * 60),
      gazeAway: w.frames ? w.gazeAway / w.frames : 0,
      tension: w.frames ? w.tension / w.frames : 0,
      smirk: w.frames ? w.smirk / w.frames : 0,
      hesitation: firstWordAt ? (firstWordAt - w.startedAt) / 1000 : null,
      pitch: voice.pitch,
      level: voice.level,
    };
  }

  endAnswer(firstWordAt = null) {
    const raw = this.current(firstWordAt);
    this.voice?.endWindow();
    this.#window = null;
    return raw;
  }

  calibrate(raw) {
    this.#calibration.push(raw);
  }

  get baseline() {
    const c = this.#calibration;
    const mean = key => {
      const xs = c.map(r => r[key]).filter(x => x !== null && x !== undefined);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };
    return {
      hrJump: mean('hrJump') ?? 0,
      restingBpm: this.#hr.length ? Math.round(this.#recentBpm()) : null,
      blinksPerMin: mean('blinksPerMin') ?? 15,
      gazeAway: mean('gazeAway') ?? 0.1,
      tension: mean('tension') ?? 0.2,
      smirk: mean('smirk') ?? 0.1,
      hesitation: mean('hesitation') ?? 1,
      pitch: mean('pitch'),
      level: mean('level'),
    };
  }

  // Compares a reading with this player's baseline. Pass the words to also
  // judge what they said, not just how they said it.
  judge(raw, { question = '', answer = '' } = {}) {
    const base = this.baseline;
    const parts = [];
    const tells = [];
    const add = (weight, score, tell) => {
      parts.push([weight, clamp01(score)]);
      if (score > 0.5 && tell) tells.push(tell);
    };

    // Body
    if (raw.hrJump !== null) {
      add(0.3, (raw.hrJump - base.hrJump) / 18, `heart rate jumped ${raw.hrJump} BPM (to ${raw.hrPeak})`);
    }
    add(0.12, (raw.blinksPerMin - base.blinksPerMin) / 20, `blinking ${raw.blinksPerMin} times a minute`);
    add(0.15, (raw.gazeAway - base.gazeAway) / 0.35, `eyes darted away ${Math.round(raw.gazeAway * 100)}% of the time`);
    add(0.1, (raw.tension - base.tension) / 0.3, 'pressed lips and a tense brow');
    add(0.1, (raw.smirk - base.smirk) / 0.25, 'duping delight: smirked while answering');

    // Voice
    if (raw.pitch && base.pitch) {
      const rise = (raw.pitch - base.pitch) / base.pitch;
      add(0.15, rise / 0.15, `voice went up ${Math.round(rise * 100)}% in pitch`);
    }
    if (raw.level && base.level) {
      add(0.08, (1 - raw.level / base.level) / 0.5, 'went quiet and mumbled');
    }
    if (raw.hesitation !== null) {
      add(0.12, (raw.hesitation - base.hesitation) / 3, `paused ${raw.hesitation.toFixed(1)}s before answering`);
    }

    // Words: flat bonus points on top, so saying "honestly" always costs you.
    let bonus = 0;
    const flag = (points, tell) => {
      bonus += points;
      tells.push(tell);
    };
    const words = answer.trim();
    if (!words && raw.seconds > 8) flag(20, 'went completely silent');
    const hedge = words.match(HEDGES);
    if (hedge) flag(15, `the honesty flag: said "${hedge[0].toLowerCase()}"`);
    const fillers = words.match(FILLERS)?.length ?? 0;
    if (fillers >= 2) flag(8, `${fillers} ums and uhs`);
    if (DENIAL.test(words) && words.split(/\s+/).length <= 3) flag(10, 'suspiciously short denial');
    if (repeatsQuestion(question, words)) flag(10, 'repeated the question to buy time');

    const totalWeight = parts.reduce((s, [w]) => s + w, 0);
    const body = (100 * parts.reduce((s, [w, v]) => s + w * v, 0)) / totalWeight;
    const stress = Math.min(100, Math.round(body + bonus));
    const verdict = stress >= 50 ? 'busted' : stress >= 32 ? 'suspicious' : stress >= 16 ? 'hmm' : 'cool';
    return { stress, verdict, tells, raw };
  }

  #recentBpm() {
    const last = this.#hr.slice(-3);
    return last.length ? last.reduce((s, r) => s + r.bpm, 0) / last.length : null;
  }
}

// True if the answer starts by echoing four or more words of the question.
function repeatsQuestion(question, answer) {
  const q = question.toLowerCase().replace(/[^a-z' ]/g, '').split(/\s+/);
  const a = answer.toLowerCase().replace(/[^a-z' ]/g, '').split(/\s+/).slice(0, 8);
  for (let i = 0; i + 4 <= a.length; i++) {
    const chunk = a.slice(i, i + 4).join(' ');
    if (q.join(' ').includes(chunk)) return true;
  }
  return false;
}
