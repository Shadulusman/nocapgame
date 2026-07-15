# Bhedi — project context for Claude Code

Social-deduction party game ("find the imposter") aimed at an Indian audience.
Installable PWA + realtime multiplayer. Two modes share one design system.

**Name:** *Bhedi* — from "ghar ka bhedi Lanka dhaaye" (the insider who leaks the secret).

---

## Current status

| Thing | State |
|---|---|
| Pass-and-play mode | Done, tested |
| Online multiplayer | Done, tested (48 automated checks pass) |
| Deploy | **NOT deployed yet.** Owner was mid-`git push`, not finished. |
| Scoring across rounds | Not built |
| Profanity filter / rate limiting | Not built |

**Immediate task the owner was stuck on:** pushing this repo to GitHub, then
deploying to Render (Build: `npm install`, Start: `node server.js`, Free tier).

The owner is a beginner with git/Node. Prefer concrete commands over explanation,
and **never put `#` comments inside a paste block** — zsh executes them as
arguments and it already broke once (`cd: too many arguments`).

---

## Run it

```bash
npm install
node server.js                 # http://localhost:8787
HOST=127.0.0.1 node server.js   # if 0.0.0.0 bind is blocked (some sandboxes)
```

Open `/` for pass-and-play, `/online.html` for multiplayer.

## Test it

```bash
node tests/e2e.js        # server: happy path, 17 checks
node tests/edge.js       # server: ties, disconnects, host migration, 14 checks
python3 tests/uitest.py  # 3 real browsers play a full game (needs playwright)
python3 tests/livetest.py # single-deploy: static serving + auto-detect + full game
```

Playwright setup: `pip install playwright && python3 -m playwright install chromium`

All four suites passed at last commit. **Run them after any change to `server.js`.**

---

## Architecture

**One Node process does everything**: serves the static files over HTTP *and*
runs the WebSocket game server on the same port. This was deliberate — it makes
deploy a single step for a non-technical owner, with no CORS and no URL to
configure. `online.html` derives its socket URL from `location.host`.

```
server.js
├── http.createServer  → serves index.html, online.html, icons/, manifest, sw.js
└── WebSocketServer({ server }) → game rooms
```

### THE critical invariant

**The imposter's device must never receive the secret word.**

`sanitize()` in `server.js` sends `yourWord: null` to imposters. The word lives
only on the server. This is the entire reason the game is server-authoritative
instead of peer-to-peer — a client-side split would let anyone win by opening
dev tools.

`tests/uitest.py` asserts the word string appears nowhere in the imposter's page
HTML. **Do not break this test. Do not "optimize" by sending the word and hiding
it in CSS.**

### State machine

```
lobby → playing → voting → results → (again → playing | backToLobby → lobby)
```

Room state lives in an in-memory `Map`. Rooms are deleted 60s after the last
player disconnects.

### WebSocket protocol

Client → server:
| type | who | payload |
|---|---|---|
| `create` | anyone | `{name}` |
| `join` | anyone | `{code, name}` |
| `rejoin` | anyone | `{code, youId}` — auto-reconnect |
| `settings` | host, lobby only | `{settings:{...}}` |
| `start` | host, lobby, 3+ players | — |
| `clue` | current turn only | `{words:[...]}` |
| `vote` | anyone, voting phase | `{targetId}` |
| `forceReveal` | host, voting | — |
| `again` | host, results | — |
| `backToLobby` | host | — |

Server → client:
- `joined` `{code, youId}` — once on connect
- `state` `{...}` — full sanitized snapshot, broadcast on every change
- `error` `{message}` — toast on client

**Design note:** the server broadcasts a full state snapshot rather than diffs.
At <12 players per room this is cheap and eliminates a whole class of desync bugs.
Don't switch to diffs without a reason.

### Server-side guards (all tested — keep them)

- Non-host cannot change settings or start
- Out-of-turn `clue` rejected
- `start` blocked under 3 players
- Clue words trimmed to 22 chars, capped at 1 per turn (one word, one player, one turn)
- `imposters` clamped 1–2 and to `players-2`; `rounds` 1–3 (rounds = how many times the
  turn order cycles, one word per player per cycle)
- Path traversal blocked in static handler

### Disconnect handling

- Host leaves → host migrates to next connected player
- Player drops on their turn → turn skips (`skipDisconnectedTurns`)
- Vote tallies against **connected** players only, so one closed tab can't freeze a round
- Reconnect: client stores `{code, youId}` in localStorage, sends `rejoin`, backs off up to 8s

### Game rules

Civilians share a secret word; imposter(s) don't. Players take turns typing
**one clue word at a time**, visible live to everyone, cycling through the same
turn order for `rounds` (1–3) passes. The client renders the full turn order as
a strip of avatars (`turnOrderHtml` in `online.html`) so it's visible who has
gone, whose turn it is, and who's next — this used to be implicit and confusing
when a turn let you submit several words in one burst; it's one word per turn now.
After the last pass, all vote. Group wins by voting out an imposter. **A tie
means nobody is voted out and the imposter wins** (`tallyAndFinish`).

Turn order is **reshuffled every round** (`order` in `startRound`). This matters:
clues are in a persistent visible feed, so going last means reading everyone
else's clues first. Randomizing spreads that advantage instead of parking it on
one seat. Don't make turn order stable.

---

## Files

| File | Notes |
|---|---|
| `index.html` | Pass-and-play. **Self-contained** — CSS inlined. |
| `online.html` | Multiplayer client. **Self-contained** — CSS inlined. |
| `server.js` | Rooms, secret word, static serving. Owns `CATEGORIES`. |
| `manifest.json`, `sw.js`, `icons/` | PWA install + offline |
| `tests/` | See above |

**Why CSS is inlined and duplicated:** it was briefly extracted to a shared
`styles.css`. That broke standalone preview (file opened alone → 404 → unstyled
page). Self-contained beats DRY here. If you re-extract it, you're re-creating a
bug that already shipped once. If you must, add a build step that inlines.

**Word data is duplicated** between `server.js` (`CATEGORIES`) and `index.html`
(local mode needs it offline; online mode must not trust the client). Editing
categories means editing both. A build step could fix this properly.

---

## Design system

Deliberately not the AI-default near-black + acid accent.

- Background: warm plum-ink `#0F0B16` (never pure black)
- Two-role color language: **gold** `#F5B547` = civilian (diya-warm, festive);
  **crimson** `#E5484D` = imposter
- Type: Bricolage Grotesque (display) / Onest (body) / Space Mono (codes, timers)
- Signature element: the foil-embossed flip card. That's where the boldness goes;
  everything else stays quiet.
- Mobile-first, safe-area aware, `prefers-reduced-motion` respected

---

## Known gaps / roadmap

1. **Scoring across rounds** — highest value next. Each round is currently
   standalone; a running tally is what turns one round into a session.
2. **Profanity filter** on typed clues and player names. None exists. Matters
   before any public promotion.
3. **Rate limiting** — someone can spam room creation. No limits at all.
4. **Custom word packs** — strong retention feature, needs UI + server storage.
5. **Rooms are in-memory** — server restart drops active games. Fine at this
   scale; needs Redis only if scaling past one instance.
6. **Word data duplication** (see above).

---

## Gotchas

- **`wss://` not `ws://`** on HTTPS pages, or browsers block the socket. Auto-detect
  in `online.html` handles this; don't hardcode.
- **Render free tier sleeps** after ~15min idle → 30–50s cold start. Looks broken,
  isn't. ~$7/mo fixes it.
- **Don't hardcode PORT** — Render injects it.
- Binding `0.0.0.0` fails in some sandboxes; use `HOST=127.0.0.1` locally.
