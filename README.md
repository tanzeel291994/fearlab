# FearLab

Party games with sensors: heart rate (WHOOP), webcam face and body tracking, an AI host (Claude), and voices (ElevenLabs).

## Running

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # first time only
cp .env.example .env                                               # then add your keys
.venv/bin/python server.py
```

Open http://localhost:5173 in **Chrome**.

Keys go in `.env` (never served to the browser):

```
ANTHROPIC_API_KEY=sk-ant-...
ELEVENLABS_API_KEY=sk_...
```

Optional settings for `.env`: `CLAUDE_MODEL` (default `claude-opus-5-5`), `CLAUDE_EFFORT` (default `low`),
`HOST_VOICE_ID` / `KIDS_VOICE_ID` (ElevenLabs voice ids), `TTS_MODEL` (default `eleven_flash_v2_5`).

### What costs credits

- **Claude:** only the Polygraph hot seat, about 8 calls per player (roughly 2-3¢ each on Opus 5.5 at low effort).
  For roughly 20× cheaper, set `CLAUDE_MODEL=claude-haiku-5-5` (the jokes will be less sharp).
  The server logs token use per call.
- **ElevenLabs:** every spoken line is cached in `.cache/tts/`, so a line costs credits only the first
  time. The kids' games use fixed lines, so after the first game they're free. Polygraph lines are new each
  time (about 100 to 150 credits per player on Flash v2.5). If ElevenLabs fails or runs out, the browser voice takes over.

## Polygraph (adults)

1. Enter the player's name, pick a spice level (mild / spicy / savage) and the number of questions.
2. Optionally connect the WHOOP (or **Demo heart**). The webcam reads face cues.
3. **Calibration:** 3 neutral questions, then 3 warm-up personality questions, record the player's honest baseline
   (including their normal voice pitch and volume).
4. **Hot seat:** Claude asks questions out loud, built from the warm-up answers. Answers are captured by Chrome speech
   recognition and **end automatically** about 2 seconds after the player stops talking (Space / **Done** still work, and typing
   is supported). After any main question, Claude may dig in with **one follow-up** and sets traps that catch contradictions.
5. **Tells** (secret while answering, revealed afterwards): heart-rate jump, voice pitch rising, mumbling, blinking,
   eyes darting, tense lips, **duping delight** (smirking), pausing, plus word tells: **the honesty flag** ("honestly",
   "I swear"…), ums and uhs, repeating the question, suspiciously short denials, going silent.
   → TRUTHFUL / HMM / SUSPICIOUS / BUSTED, and a scrolling polygraph paper trace whose pens tremble with stress.
6. **Report:** personality title, honesty score, every answer with its tells, and **Exhibit A**: a snapshot of the
   player's guiltiest face of the night (it stays on this computer).

## Dance Battle (kids)

Up to 4 dancers, body tracking via MediaPipe Pose. Points for how much you move (scaled to body size,
so near and far dancers are scored fairly) plus bonuses for brave moves: jump +10, star jump +8, squat +6, hands up +5.
**Freeze Dance** mode: the built-in beat stops at random. Wobbling loses points and holding still earns
points. Everyone gets an award (Super Kangaroo, Statue Master, Wiggle Wizard…).

## Step 1: live heart rate from WHOOP

1. In the WHOOP app: **Device settings → Broadcast Heart Rate → On**.
2. Start the server (see **Running** above) and open http://localhost:5173/heart.html in **Chrome**.
3. Click **Connect WHOOP** and pick your strap from the list.

No band nearby? Click **Demo mode** for simulated heart rate, plus a "Fake a spike" button.

### Troubleshooting
- **Strap missing from the picker:** make sure broadcast is on, and that Chrome has Bluetooth permission
  (macOS System Settings → Privacy & Security → Bluetooth → Google Chrome).
- **Disconnects:** the app retries automatically for about a minute.

## Step 2: Face Challenge (webcam)

Open http://localhost:5173/face.html and allow the camera.

Pick a challenge (scariest monster, most scared, surprised, biggest smile, angriest, saddest) and press
**Start round**. After a 3-2-1 countdown, players have 5 seconds to pull their best face. Up to 4 people
can play at once, numbered P1–P4 from left to right. Each player's best moment is saved as a
snapshot with a score and a joke.

Face tracking runs locally with MediaPipe Face Landmarker. Nothing is uploaded.

**Tuning scores:** turn on **Show face data** to see the raw expression values, then adjust each
challenge's `recipe` or `full` in `web/expressions.js`.
