// Speaking (ElevenLabs via the local server, browser voice as fallback) and
// listening (Chrome's built-in speech recognition).

let playing = null; // { audio, done }
let speakId = 0;
const clips = new Map(); // "voice|text" -> Promise<blob URL>

// Fetches a line ahead of time so speak() can play it without delay.
export function preload(text, voice = 'host') {
  const key = `${voice}|${text}`;
  if (!clips.has(key)) {
    const clip = fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }),
    }).then(async res => {
      if (!res.ok) throw new Error((await res.json()).error);
      return URL.createObjectURL(await res.blob());
    });
    clip.catch(() => clips.delete(key)); // let a later call retry
    clips.set(key, clip);
  }
  return clips.get(key);
}

export async function speak(text, { voice = 'host' } = {}) {
  stopSpeaking();
  if (!text) return;
  const id = ++speakId;
  try {
    const audio = new Audio(await preload(text, voice));
    if (id !== speakId) return; // a newer line started while this one loaded
    await new Promise(resolve => {
      playing = { audio, done: resolve };
      audio.onended = audio.onerror = resolve;
      audio.play().catch(resolve);
    });
  } catch (err) {
    console.warn('ElevenLabs unavailable, using the browser voice:', err.message);
    await browserSpeak(text);
  }
}

export function stopSpeaking() {
  if (playing) {
    playing.audio.pause();
    playing.done();
    playing = null;
  }
  speechSynthesis.cancel();
}

function browserSpeak(text) {
  return new Promise(resolve => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = utterance.onerror = resolve;
    speechSynthesis.speak(utterance);
  });
}

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = Boolean(Recognition);

// Starts listening. Returns { stop(): Promise<string>, firstWordAt, lastWordAt, active }.
// onText(transcript) fires as words come in.
export function listen(onText = () => {}) {
  const handle = { firstWordAt: null, lastWordAt: null, active: Boolean(Recognition), stop: async () => '' };
  if (!Recognition) return handle;

  let finalText = '';
  let interim = '';
  let stopped = false;
  let resolveEnd;
  const ended = new Promise(r => (resolveEnd = r));

  const start = () => {
    const rec = new Recognition();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = e => {
      handle.firstWordAt ??= performance.now();
      handle.lastWordAt = performance.now();
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += `${r[0].transcript} `;
        else interim += r[0].transcript;
      }
      onText((finalText + interim).trim());
    };
    // Chrome ends recognition on its own after a pause: restart until we're told to stop.
    rec.onend = () => (stopped ? resolveEnd() : start());
    rec.onerror = e => {
      if (e.error === 'not-allowed') {
        stopped = true;
        handle.active = false; // mic blocked: fall back to typing + the Done button
      }
    };
    rec.start();
    handle.rec = rec;
  };
  start();

  handle.stop = async () => {
    stopped = true;
    handle.rec.stop();
    await Promise.race([ended, new Promise(r => setTimeout(r, 1500))]);
    return (finalText + interim).trim();
  };
  return handle;
}
