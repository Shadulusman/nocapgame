# Bhedi — project context for Claude Code

Social-deduction party game ("find the imposter") aimed at an Indian audience.
Installable PWA + realtime multiplayer. Two modes share one design system.

**Name:** *Bhedi* — from "ghar ka bhedi Lanka dhaaye" (the insider who leaks the secret).

---

## Current status

| Thing | State |
|---|---|
| Pass-and-play mode | Done, tested |
| Online multiplayer | Done, tested (see "Test it" — all 4 suites must pass) |
| Deploy | Pushed to GitHub (`Shadulusman/bhedi`). Render deploy is a manual step the owner does via the dashboard. |
| Scoring across rounds | Not built |
| Profanity filter / rate limiting | Not built |

**Repo is pushed to GitHub** (`Shadulusman/bhedi`, `main`). Render deploy
(Build: `npm install`, Start: `node server.js`, Free tier) is a manual dashboard
step the owner does themselves — walk them through the clicks, don't attempt it
via CLI.

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
node tests/e2e.js        # server: happy path
node tests/edge.js       # server: ties, disconnects, host migration, reconnect races, vote timeout, chat, auto-start scheduling
node tests/autostart.js  # server: public lobby actually auto-starts (runs with LOBBY_SECONDS=2)
python3 tests/uitest.py  # 3 real browsers play a full game (needs playwright)
python3 tests/livetest.py # single-deploy: static serving + auto-detect + room browser + full game
```

Playwright setup: `pip install playwright && python3 -m playwright install chromium`

Don't hardcode check counts in comments/docs here — they drift every time a test
is added. All suites passed at last commit. **Run them after any change to
`server.js`.** `autostart.js` is separate from `edge.js` on purpose: a short
`LOBBY_SECONDS` would auto-start rooms in the edge tests that deliberately sit
in the lobby, so the real-firing test gets its own process.

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

`tests/uitest.py` captures every raw websocket frame the imposter's browser
receives and asserts the word string appears in none of them. It checks network
payloads rather than `page.content()` — the full HTML/JS source contains static
code comments and UI copy that can coincidentally match a random secret word
and false-positive (this happened: a category word "Header" once matched a CSS
section comment). **Do not break this test. Do not "optimize" by sending
the word and hiding it in CSS.**

### State machine

```
lobby → playing → voting → results → (again → playing | backToLobby → lobby)
```

Room state lives in an in-memory `Map`. Rooms are deleted 60s after the last
player disconnects.

**Lobby auto-start:** any lobby with 3+ connected players starts a
`LOBBY_SECONDS` (60s) countdown (`refreshAutoStart` → `room.autoStartTimer` /
`room.autoStartAt`). At zero it calls `startRound` on its own; the host can start
early. Dropping below 3 cancels it. `startRound` always `cancelAutoStart`s so a
stale timer can't fire into a running game. Sanitized state exposes `autoStartAt`
(ms) in the lobby so clients render "Starts in 0:58"; `/rooms` exposes it too.
There is no public/private room distinction — every lobby is listed and eligible.

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
| `chat` | anyone, if `settings.chat` on | `{text}` — lobby/playing/voting; trimmed to 160, ~350ms/msg rate limit |
| `forceReveal` | host, voting | — |
| `again` | host, results | — |
| `backToLobby` | host | — |

Server → client:
- `joined` `{code, youId}` — once on connect
- `state` `{...}` — full sanitized snapshot, broadcast on every change. Always
  carries `chat` (last 50 msgs, or `[]` when the host disabled chat) and, in the
  lobby, `autoStartAt`.
- `error` `{message}` — toast on client

**Design note:** the server broadcasts a full state snapshot rather than diffs.
At <12 players per room this is cheap and eliminates a whole class of desync bugs.
Don't switch to diffs without a reason.

### HTTP endpoints (besides static files)

- `GET /health` → `200 "ok"`
- `GET /rooms` → JSON array of open (lobby-status, not full) rooms:
  `[{code, hostName, players, maxPlayers, imposters, names[], autoStartAt}, ...]`,
  capped at 30, fullest first. Powers the **Public Rooms** browser on the entry
  screen — the client renders host avatar, player bubbles (`names`), an imposter
  chip, and a status derived from `players`/`autoStartAt` ("Needs N more" /
  "Starts in 0:58" / "Ready to start"), ticking every second. Anyone can tap to
  join without a code; code-join still works. Room codes are already meant to be
  shareable so this isn't sensitive data; response has `Access-Control-Allow-Origin: *`
  and `Cache-Control: no-store`. **The `no-store` + the explicit bypass in
  `sw.js`'s fetch handler both matter** — this is live data, and the service
  worker's cache-first strategy (meant for static assets) would otherwise freeze
  the list at whatever it was on the very first fetch, forever, for that browser.
  If you add another dynamic endpoint, remember to exclude it in `sw.js` too.

### Server-side guards (all tested — keep them)

- Non-host cannot change settings or start
- Out-of-turn `clue` rejected
- `start` blocked under 3 players
- Clue words trimmed to 22 chars, capped at 1 per turn (one word, one player, one turn)
- `imposters` clamped 1–2 and to `players-2`; `rounds` 1–3 (rounds = how many times the
  turn order cycles, one word per player per cycle)
- `chat` messages dropped unless `settings.chat` is on; trimmed to 160 chars,
  whitespace-collapsed, ~350ms per-player rate limit, only in lobby/playing/voting
- Path traversal blocked in static handler

### Disconnect handling

- Host leaves → host migrates to next connected player
- Player drops on their turn → turn skips (`skipDisconnectedTurns`)
- Vote tallies against **connected** players only, so one closed tab can't freeze a round
- Reconnect: client stores `{code, youId}` in localStorage, sends `rejoin`, backs off up to 8s
- **Stale-close guard**: on `rejoin`, `server.js` swaps `p.ws` to the new socket. The
  *old* socket's `close` event can still fire later (mobile backgrounding, the 30s
  heartbeat, flaky networks routinely reconnect before the dead socket is noticed).
  The `close` handler only marks a player disconnected if `p.ws === ws` — i.e. this
  is still their current socket. Without that check, a late close on an already-replaced
  socket would wrongly flip a connected player to disconnected: `broadcast()` then
  skips them (looks like "have to refresh to see updates"), and `reassignHostIfNeeded`
  can steal host from someone who never left. Do not remove that check.

### Game rules

Civilians share a secret word; imposter(s) don't. Players take turns typing
**one clue word at a time**, visible live to everyone, cycling through the same
turn order for `rounds` (1–3) passes. The client renders the full turn order as
a strip of avatars (`turnOrderHtml` in `online.html`) so it's visible who has
gone, whose turn it is, and who's next — this used to be implicit and confusing
when a turn let you submit several words in one burst; it's one word per turn now.
The clue feed (`feedGridHtml`) groups by *person* — one row per player, their
words laid out alongside each other in round order — rather than one row per
clue stacked chronologically, so you can actually scan "what did X say" instead
of hunting through an interleaved list.

After the last pass, voting starts and **auto-resolves after `VOTE_SECONDS`
(30s, overridable via env var for tests)** even if not everyone has voted —
`scheduleVoteTimeout` in `server.js`. The timer lives on the round object, not
the room, so a stale timeout from an earlier round can't tally the wrong round
after `again` starts a fresh one (checks `room.round === r` before acting).
Group wins by voting out an imposter. **A tie means nobody is voted out and the
imposter wins** (`tallyAndFinish`, which also clears the vote timer — every
path that resolves voting goes through it, so the timer never double-fires).

Turn order is **reshuffled every round** (`order` in `startRound`, via the
Fisher-Yates `shuffle()` helper — not `sort(() => Math.random() - .5)`, which
looked like a shuffle but was heavily biased toward keeping early elements in
place and made the host disproportionately likely to land as imposter). This
matters: clues are in a persistent visible feed, so going last means reading
everyone else's clues first. Randomizing spreads that advantage instead of
parking it on one seat. Don't make turn order stable.

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
categories means editing both — keep the two arrays byte-identical. Current packs
(10): Easy Words, Trending, Around the World, Entertainment, Everyday Things,
Animals & Nature, Sports & Leisure, School, Celebrations, Celebrities. A build
step could fix the duplication properly.

**In-game chat** (online only): a shared bottom-sheet drawer (`#chatSheet`) opened
from a 💬 button on the lobby and play topbars, with an unread badge. Host toggles
it in Round settings (`settings.chat`); when off, the buttons hide and the server
drops messages + sends `chat: []`. Messages come down inside the normal `state`
snapshot — no separate socket channel.

**Mode-selector cards** ("Pass the phone" / "Play online") sit at the top of both
entry screens and just cross-link the two self-contained files (index ⇄ online) —
they do NOT merge them. The selected card is styled `.mode-card.sel`.

---

## Design system

**Neon-blue "arcade" theme** on a dark canvas (this replaced a short-lived light
theme; the owner wanted a distinct game vibe, not the generic look). Electric
cyan + glow everywhere, faint background grid, glowing display type.

- Background: near-black navy `#070A16` (`--ink`) with cyan/pink/violet radial
  glows and a faint 46px cyan grid. Cards (`--surface` `#111834`) are dark with
  neon borders/shadows.
- Two-role color language: **electric cyan** `#35D6FF` = civilian; **neon pink-red**
  `#FF3D6E` (`--crimson`) = imposter. Accent as a *fill* uses dark text
  (`#04121F`); accent as *text on dark* uses the BRIGHT `--gold-ink` `#7FE4FF`
  (not `--gold-deep`, which is the darker gradient/border cyan). Glow is done with
  `text-shadow`/`box-shadow`/`filter:drop-shadow` in cyan or pink rgba.
- **Token names are inherited, not accurate:** `--gold*` are cyan now, `--crimson*`
  are neon pink-red, `--cream` (`#E9EEFF`) is the near-white primary text, and
  `--ink*`/`--surface*` are dark. They kept the old names so the hundreds of
  `var(--…)` usages across the two duplicated files didn't need renaming. To
  re-theme, remap the `:root` block in **both** `index.html` and `online.html`,
  the `<meta name="theme-color">`, and `manifest.json` — plus the handful of
  hardcoded literals (`fill="#35D6FF"` logo, flip-card gradients, avatar `AV`
  palette, `#04121F` accent-text). The bulk tints are `rgba(53,214,255,…)` (cyan),
  `rgba(255,61,110,…)` (pink), `rgba(43,227,138,…)` (green).
- ⚠️ **Comment trap:** never write `*/` inside a CSS comment (e.g. describing
  `var(--gold-*/-something)`). It closes the comment early and silently corrupts
  the next declarations — this exact bug made `--ink` resolve to empty and the
  whole background render white. Bit us once; the "neon accents" block and `:root`
  comment are written to avoid it.
- Type: **Orbitron** (display/headings/buttons — the game look) / **Rajdhani**
  (body/UI, runs light so body is `font-weight:500`) / **Share Tech Mono** (codes,
  timers, labels).
- Signature element: the flip card. Civ face = dark with a cyan-glowing word +
  cyan border glow; imp face = dark with a pink-glowing "IMPOSTER". That's where
  the boldest glow lives.
- Toasts are a dark surface with a cyan glow border.
- Mobile-first, safe-area aware, `prefers-reduced-motion` respected.
- `livetest.py` asserts `body` computes to `rgb(7, 10, 22)` — update it if the
  background token changes.

---

## Known gaps / roadmap

1. **Scoring across rounds** — highest value next. Each round is currently
   standalone; a running tally is what turns one round into a session.
2. **Profanity filter** on typed clues, player names, **and now chat messages**.
   None exists. Chat makes this matter more — anyone in a public room sees it.
   Needed before any public promotion.
3. **Rate limiting** — chat has a light per-player gap, but room creation has no
   limits at all; someone can still spam new rooms.
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
