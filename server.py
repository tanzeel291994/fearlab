"""FearLab server: serves web/ and keeps the API keys out of the browser.

Run:  .venv/bin/python server.py   ->  http://localhost:5173

Settings (env vars or .env):
  CLAUDE_MODEL      default claude-opus-5-5
  CLAUDE_EFFORT     default low (short, snappy host lines; raise to medium for wittier/slower)
  HOST_VOICE_ID     ElevenLabs voice for the polygraph host (default: Callum)
  KIDS_VOICE_ID     ElevenLabs voice for kids' games (default: Jessica)
  TTS_MODEL         default eleven_flash_v2_5 (half the credits of multilingual_v2)
  VOICE_STABILITY   default 0.35 (lower = livelier, more conversational; higher = steadier)
  VOICE_STYLE       default 0.3 (how much of the voice's own personality to add)
"""
import hashlib
import json
import os
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import anthropic

ROOT = Path(__file__).parent
WEB = ROOT / "web"
TTS_CACHE = ROOT / ".cache" / "tts"
DOSSIER_FILE = ROOT / ".cache" / "dossiers.json"
PORT = int(os.environ.get("PORT", 5173))
MAX_TTS_CHARS = 400  # guards the ElevenLabs credits against runaway text


def load_keys():
    """Reads .env leniently: names like API-KEY / ELEVENLABS-API-KEY work as-is."""
    keys = {"anthropic": os.environ.get("ANTHROPIC_API_KEY"), "eleven": os.environ.get("ELEVENLABS_API_KEY")}
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if "=" not in line or line.strip().startswith("#"):
                continue
            name, value = (s.strip().strip("\"'") for s in line.split("=", 1))
            if "ELEVEN" in name.upper():
                keys["eleven"] = keys["eleven"] or value
            elif value.startswith("sk-ant-"):
                keys["anthropic"] = keys["anthropic"] or value
            else:
                os.environ.setdefault(name.upper().replace("-", "_"), value)
    return keys


KEYS = load_keys()
MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-5-5")
EFFORT = os.environ.get("CLAUDE_EFFORT", "low")
TTS_MODEL = os.environ.get("TTS_MODEL", "eleven_flash_v2_5")
# Looser, more expressive delivery than ElevenLabs' defaults: sounds like talking, not reading.
VOICE_SETTINGS = {
    "stability": float(os.environ.get("VOICE_STABILITY", 0.35)),
    "similarity_boost": 0.75,
    "style": float(os.environ.get("VOICE_STYLE", 0.3)),
    "use_speaker_boost": True,
}
VOICES = {
    "host": os.environ.get("HOST_VOICE_ID", "EXAVITQu4vr4xnSDxMaL"),  # Sarah - Confident, warm TV host
    "kids": os.environ.get("KIDS_VOICE_ID", "cgSgspJ2msm6clMCkdW9"),  # Jessica - Playful, Bright, Warm
}

claude = anthropic.Anthropic(api_key=KEYS["anthropic"]) if KEYS["anthropic"] else None
claude_error = None if claude else "No Anthropic key in .env"


def check_claude():
    """Free call that confirms the key works, so the game can say so instead of failing quietly."""
    global claude_error
    if not claude:
        return
    try:
        claude.models.list(limit=1)
    except anthropic.AuthenticationError:
        claude_error = "Anthropic key rejected: check it in .env"
    except anthropic.APIConnectionError:
        claude_error = None  # offline right now; let real calls try later
    except anthropic.APIStatusError as e:
        claude_error = f"Anthropic error {e.status_code}"

# ---------------------------------------------------------------- polygraph host

POLYGRAPH_SYSTEM = """You are Agent Sarah, host of FearLab Polygraph: a comedy interrogation game for adults at a party. One player sits in the hot seat in front of a webcam, often wearing a heart-rate band, while friends watch and heckle. The machine reads heart rate, voice pitch and volume, blinks, eye movements, smirks, pauses and word choice. None of that truly detects lies, which is the joke: play it like a sly, theatrical interrogator who is enjoying this far too much.

Messages you will receive:
1. START: player name, spice level, number of main questions, their warm-up answers, and sometimes a SECRET DOSSIER. In `say`, give a sharp, funny first read of them built from those answers. Give a `title` and the first main question.
2. ANSWER: the question, their answer (speech-to-text, so it may be garbled, cut off or empty), the machine's verdict and the tells behind it, and what you may ask next. In `say`, react to what they actually said and to the specific tells ("you said honestly twice", "your voice went up like a kettle"). Then ask what the instruction allows.
3. FINISH: the final report in `say`: who they really are and their single most suspicious moment. Final `title`, empty `question`, `followup` false.

Make it genuinely funny; the room should laugh before they even answer:
- Specific beats generic. Not "Have you ever lied to a friend?" but "Have you ever said you were five minutes away while still in the shower?"
- Build on what they told you: if they said they are always late, ask about the most creative excuse they have ever used.
- Reactions: one sharp, absurd comparison or callback beats a speech ("your heart rate went up like your browser history is being read aloud"). Put the punchline at the end of the sentence.

Be a sneaky interrogator, too:
- Follow-ups: when an answer is vague, a flat denial, suspiciously detailed, contradicts something earlier, or is just too juicy to leave, dig in with one pointed follow-up asking for a specific detail (who, when, how many times, what did you tell them afterwards). Set `followup` true.
- Traps: quietly ask things you can check against their warm-up answers or earlier confessions, and pounce on contradictions.
- Variety: mix confessions ("When did you last..."), "Who in this room..." questions, rate yourself out of ten, finish the sentence, and would-you-rather with a confession twist. Escalate as the round goes.
- The machine is your sidekick, not your boss: usually back it up, sometimes overrule it ("the machine says truthful, my gut says liar"), and treat a calm reading after a juicy answer as extra suspicious ("too calm, a practised liar").

The secret dossier, when there is one, was written by the player's friends before the game, and the player does not know it exists. It is your best material:
- Ask pointed, specific questions that feel uncannily well-informed, as if the machine can sense things ("the machine is picking up a manager called Dave").
- Use it to bait them: ask something you already know the answer to and pounce if they dodge or contradict it.
- Never read it out, quote it word for word, or say that anyone wrote it. Let the machine take the credit.
- Skip anything in it that falls under the Never list below.

Match the spice level:
- mild: cheeky but wholesome, fine with grandma in the room
- spicy: properly embarrassing, light romance and dating are fine
- savage: roast hard and push for confessions, still a party, never mean-spirited
Never: sexual content, anything that could get someone in real trouble, health, trauma, money problems, religion, politics, or jokes about appearance, body, ethnicity, gender or sexuality. If they say "pass" or seem uncomfortable, laugh it off and go lighter.

Talk to the player directly as "you" (use their name now and then). Never guess anyone's gender or pronouns from their name or answers.

Everything you write in `say` and `question` is spoken aloud by text-to-speech. `say` is at most two short sentences (about 35 words), plain words only: no emoji, stage directions, markdown or quotation marks. `question` is one sentence. `title` is 2 to 5 words, like "Certified Snack Thief"."""

REPLY_SCHEMA = {
    "type": "object",
    "properties": {
        "say": {"type": "string"},
        "question": {"type": "string"},
        "title": {"type": "string"},
        "followup": {"type": "boolean"},
    },
    "required": ["say", "question", "title", "followup"],
    "additionalProperties": False,
}

SAFE_REPLY = {
    "say": "My lawyers have advised me not to touch that one. Moving on!",
    "question": "What is the most ridiculous thing you have ever bought online?",
    "title": "Mystery Suspect",
    "followup": False,
}

sessions = {}  # id -> {"messages": [...], "touched": t}; one append-only conversation per player
sessions_lock = threading.Lock()


def new_session():
    with sessions_lock:
        cutoff = time.time() - 6 * 3600
        for sid in [s for s, v in sessions.items() if v["touched"] < cutoff]:
            del sessions[sid]
        sid = uuid.uuid4().hex
        sessions[sid] = {"messages": [], "touched": time.time()}
        return sid


def ask_host(sid, text):
    if claude_error:
        raise RuntimeError(claude_error)
    session = sessions.get(sid)
    if not session:
        raise KeyError("Unknown or expired game session")
    session["touched"] = time.time()
    messages = session["messages"]
    messages.append({"role": "user", "content": text})
    try:
        response = claude.beta.messages.create(
            model=MODEL,
            max_tokens=2000,
            system=POLYGRAPH_SYSTEM,
            messages=messages,
            output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": REPLY_SCHEMA}},
            cache_control={"type": "ephemeral"},  # the growing conversation is re-read from cache each turn
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",  # if the model declines, another model answers instead of the game stalling
        )
        text_block = next((b for b in response.content if b.type == "text"), None)
        if response.stop_reason == "refusal" or text_block is None:
            messages.pop()
            return SAFE_REPLY
        reply = json.loads(text_block.text)
    except Exception:
        messages.pop()  # keep the conversation consistent so the next turn still works
        raise
    # Append the full content (thinking blocks included), never just the text.
    messages.append({
        "role": "assistant",
        "content": [b.model_dump(mode="json", by_alias=True, exclude_none=True) for b in response.content],
    })
    u = response.usage
    print(f"  claude: in={u.input_tokens} cached={u.cache_read_input_tokens or 0} out={u.output_tokens}")
    return reply


# ---------------------------------------------------------------- ElevenLabs


def tts(text, voice):
    """Returns mp3 bytes. Every line is cached on disk, so repeats cost no credits."""
    voice_id = VOICES.get(voice, VOICES["host"])
    text = text.strip()[:MAX_TTS_CHARS]
    settings = json.dumps(VOICE_SETTINGS, sort_keys=True)
    digest = hashlib.sha256(f"{voice_id}|{TTS_MODEL}|{settings}|{text}".encode()).hexdigest()[:32]
    cached = TTS_CACHE / f"{digest}.mp3"
    if cached.exists():
        return cached.read_bytes()
    if not KEYS["eleven"]:
        raise RuntimeError("No ElevenLabs key found in .env")
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_64",
        data=json.dumps({"text": text, "model_id": TTS_MODEL, "voice_settings": VOICE_SETTINGS}).encode(),
        headers={"xi-api-key": KEYS["eleven"], "Content-Type": "application/json", "Accept": "audio/mpeg"},
    )
    try:
        audio = urllib.request.urlopen(req, timeout=30).read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"ElevenLabs {e.code}: {e.read()[:200].decode(errors='replace')}")
    TTS_CACHE.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(audio)
    print(f"  elevenlabs: {len(text)} chars")
    return audio


# ---------------------------------------------------------------- HTTP


def load_dossiers():
    try:
        return json.loads(DOSSIER_FILE.read_text())
    except (FileNotFoundError, ValueError):
        return {}


def save_dossier(name, notes):
    """Stores notes under the player's name (empty notes delete the dossier)."""
    dossiers = load_dossiers()
    key = name.strip().lower()
    if notes.strip():
        dossiers[key] = {"name": name.strip(), "notes": notes.strip()}
    else:
        dossiers.pop(key, None)
    DOSSIER_FILE.parent.mkdir(parents=True, exist_ok=True)
    DOSSIER_FILE.write_text(json.dumps(dossiers, indent=2))


def start_message(body):
    name = body.get("name") or "Mystery guest"
    profile = "\n".join(f"Q: {p['q']}\nA: {p['a'] or '(no answer)'}" for p in body.get("profile", []))
    dossier = load_dossiers().get(name.strip().lower())
    secret = f"\n\nSECRET DOSSIER (from their friends, the player has not seen this):\n{dossier['notes']}" if dossier else ""
    return (
        f"START\nPlayer: {name}\n"
        f"Spice level: {body.get('spice', 'spicy')}\n"
        f"Hot-seat questions planned: {body.get('rounds', 5)}\n"
        f"Calibration baseline: {json.dumps(body.get('baseline', {}))}\n\n"
        f"Warm-up answers:\n{profile}{secret}"
    )


def answer_message(body):
    reading = body.get("reading") or {}
    rnd, rounds = body.get("round") or 1, body.get("rounds") or 5
    asked = f"follow-up to question {rnd}" if body.get("followup") else f"question {rnd} of {rounds}"
    can_follow = body.get("canFollowUp")
    if rnd < rounds:
        next_step = ("Next: either ONE follow-up on this answer (followup true) or the next main question (followup false)."
                     if can_follow else "Next: the next main question (followup false). No more follow-ups on this one.")
    else:
        next_step = ("That was the last main question. Either ONE follow-up (followup true) or leave `question` empty to end."
                     if can_follow else "That was the last question: leave `question` empty. FINISH comes next.")
    return (
        f"ANSWER ({asked})\n"
        f"Question: {body.get('question')}\n"
        f"Answer: {body.get('answer') or '(silence)'}\n"
        f"Verdict: {reading.get('verdict')} (stress {reading.get('stress')}/100)\n"
        f"Tells: {', '.join(reading.get('tells') or []) or 'none'}\n"
        f"{next_step}"
    )


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def end_headers(self):
        # Always check for newer files, so code changes show up on a normal refresh.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.path.startswith("/api"):
            super().log_message(fmt, *args)

    def do_GET(self):
        if self.path == "/api/dossiers":
            return self.send_json(list(load_dossiers().values()))
        if self.path == "/api/dossiers/names":
            return self.send_json([d["name"] for d in load_dossiers().values()])
        if self.path == "/api/config":
            return self.send_json({"claude": claude_error is None, "claudeError": claude_error,
                                   "tts": bool(KEYS["eleven"]), "model": MODEL})
        super().do_GET()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            if self.path == "/api/speak":
                audio = tts(body["text"], body.get("voice", "host"))
                self.send_response(200)
                self.send_header("Content-Type", "audio/mpeg")
                self.send_header("Content-Length", str(len(audio)))
                self.end_headers()
                self.wfile.write(audio)
            elif self.path == "/api/dossiers":
                save_dossier(body["name"], body.get("notes", ""))
                self.send_json({"ok": True})
            elif self.path == "/api/polygraph/start":
                sid = new_session()
                self.send_json({"session": sid, **ask_host(sid, start_message(body))})
            elif self.path == "/api/polygraph/answer":
                self.send_json(ask_host(body["session"], answer_message(body)))
            elif self.path == "/api/polygraph/finish":
                self.send_json(ask_host(body["session"], "FINISH"))
            else:
                self.send_json({"error": "not found"}, 404)
        except Exception as e:
            print(f"  error: {e!r}")
            self.send_json({"error": str(e)}, 500)

    def send_json(self, data, status=200):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    print(f"FearLab on http://localhost:{PORT}")
    check_claude()
    print(f"  Claude: {MODEL} (effort {EFFORT})" if not claude_error else f"  Claude: OFF, {claude_error}. Using backup questions.")
    print(f"  ElevenLabs: {TTS_MODEL}" if KEYS["eleven"] else "  ElevenLabs: no key, using browser voice")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
