# NOCAP — project context for Claude Code

Social-deduction party game ("find the imposter"). Installable PWA + realtime
multiplayer. Two modes share one design system.

**Name:** *NOCAP* — "online imposter game" (slang: "no cap" = no lie). Rebranded
from an earlier name, *Bhedi*; user-facing copy calls the hidden role the
**imposter**. If you see leftover "bhedi" anywhere, it's a stray — replace it.

---

## Current status

| Thing | State |
|---|---|
| Pass-and-play mode | Done, tested |
| Online multiplayer | Done, tested (see "Test it" — all 4 suites must pass) |
| Deploy | Pushed to GitHub (`Shadulusman/bhedi`, the repo is still named `bhedi`). Render deploy is a manual dashboard step. |
| Scoring across rounds | Not built |
| Profanity filter / rate limiting | Not built |

**Repo is pushed to GitHub** (`Shadulusman/bhedi`, `main`) — repo not renamed.
The intended **play URL is `nocapgame.onrender.com`**, which comes from the
Render *service* name (rename the service in Render → Settings, or create it as
`nocapgame`), NOT from the repo name. Render deploy (Build: `npm install`, Start:
`node server.js`, Free tier) is a manual dashboard step the owner does themselves
— walk them through the clicks, don't attempt it via CLI. A `keep-warm` GitHub
Action pings `/health` every 10 min (needs a `RENDER_URL` repo variable) so the
free instance doesn't cold-start.

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
lobby → [ playing → voting ]* → results → (again → playing | backToLobby → lobby)
```

**Game loop (vote every round, elimination):** a game is ONE `room.round` that
spans many rounds. Each round = one clue pass (every alive player types one word,
`skipUnavailableTurns` skips dead/disconnected) → a **vote phase**. In the vote
phase everyone alive votes; `resolveVote` adds those votes to the cumulative
`round.tally`, then eliminates every alive player whose total ≥ `voteThreshold`
(a MAJORITY of the still-alive: `floor(alive/2)+1`, recomputed as people die).
Win check: **civilians win** when all imposters are eliminated; **imposters win**
when `aliveImposters >= aliveCivilians`; otherwise `roundNo++` and a new clue
pass starts (the tally carries over). `endGame` builds the reveal. Key round
fields: `imposterIds`, `order`, `dead` (Set), `tally` (Map, cumulative),
`roundNo`, `deaths`. Votes are cast on ALIVE players only; the dead spectate.

Room state lives in an in-memory `Map`. Rooms are deleted 60s after the last
player disconnects.

**Lobby auto-start:** any lobby with 3+ connected players starts a
`LOBBY_SECONDS` (60s) countdown (`refreshAutoStart` → `room.autoStartTimer` /
`room.autoStartAt`). At zero it calls `startRound`; the host can start early;
dropping below 3 cancels it. `startRound` always `cancelAutoStart`s.

**Public vs private rooms:** `create` takes `{public}`. Private (default) rooms
are code-join only and hidden from `/rooms`. Public rooms ("Create a public
room") appear in the browser; in-progress public rooms are listed too but flagged
`inGame`/`joinable:false` (client shows a blinking "In game" badge, not a Join).

### WebSocket protocol

Client → server:
| type | who | payload |
|---|---|---|
| `create` | anyone | `{name, public}` — `public:true` = listed in the browser |
| `join` | anyone | `{code, name}` |
| `rejoin` | anyone | `{code, youId}` — auto-reconnect |
| `settings` | host, lobby only | `{settings:{...}}` |
| `start` | host, lobby, 3+ players | — |
| `clue` | current turn, alive only | `{words:[...]}` |
| `vote` | alive players, voting phase | `{targetId}` — must be an alive player |
| `chat` | anyone, if `settings.chat` on | `{text}` — lobby/playing/voting; trimmed to 160, ~350ms/msg rate limit |
| `kick` | host | `{targetId}` — removes a player, drops them from a running game |
| `forceReveal` | host, voting | — (resolve this round's vote now) |
| `again` | host, results | — |
| `backToLobby` | host | — |

Server → client:
- `joined` `{code, youId}` — once on connect
- `state` `{...}` — full sanitized snapshot, broadcast on every change. Always
  carries `chat` (last 50 msgs, or `[]` when the host disabled chat) and, in the
  lobby, `autoStartAt`. In play/vote the round carries `order[]` (with per-player
  `dead`/`votes`/`connected`), `roundNo`, `threshold`, `yourAlive`.
- `kicked` — sent to a removed player just before their socket is closed; the
  client clears its session (so it won't auto-rejoin) and returns to entry.
- `error` `{message}` — toast on client

**Design note:** the server broadcasts a full state snapshot rather than diffs.
At <12 players per room this is cheap and eliminates a whole class of desync bugs.
Don't switch to diffs without a reason.

### HTTP endpoints (besides static files)

- `GET /health` → `200 "ok"`
- `GET /rooms` → JSON array of **public** rooms (private rooms never appear):
  `[{code, hostName, players, maxPlayers, imposters, names[], cats, cat1,
  autoStartAt, status, inGame, joinable}, ...]`, capped at 30, joinable first.
  Includes lobby rooms (joinable) AND in-progress public rooms (`inGame:true`,
  `joinable:false` → the client shows a blinking "In game" badge and blocks the
  tap). Powers the **Public Rooms** browser — host avatar, player bubbles
  (`names`), category + imposter chips, and a status ("Needs N more" / "Starts in
  0:58" / "Ready to start" / "In game"), ticking every second. Room codes are
  meant to be shareable so this isn't sensitive; response has `Access-Control-Allow-Origin: *`
  and `Cache-Control: no-store`. **The `no-store` + the explicit bypass in
  `sw.js`'s fetch handler both matter** — this is live data, and the service
  worker's cache-first strategy (meant for static assets) would otherwise freeze
  the list at whatever it was on the very first fetch, forever, for that browser.
  If you add another dynamic endpoint, remember to exclude it in `sw.js` too.

### Server-side guards (all tested — keep them)

- Non-host cannot change settings, start, or `kick`
- Out-of-turn or dead-player `clue` rejected (`isAvailable` guard)
- `vote` accepted only from alive players, and only for an alive target
- `kick` is host-only and can't target self; kicked player is `dead`-marked +
  socket-closed; they get a `kicked` message so they don't auto-rejoin
- `start` blocked under 3 players
- Clue words trimmed to 22 chars, capped at 1 per turn
- `imposters` clamped 1–2 and to `players-2`
- `chat` messages dropped unless `settings.chat` is on; trimmed to 160 chars,
  whitespace-collapsed, ~350ms per-player rate limit, only in lobby/playing/voting
- Path traversal blocked in static handler

### Disconnect handling

- Host leaves → host migrates to next connected player
- Player drops on their turn → turn skips (`skipUnavailableTurns`)
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

Civilians share a secret word; imposter(s) don't. Each **round**, players take
turns typing **one clue word** (one per player, alive players only), then everyone
votes — see the "Game loop" under the state machine for the full elimination /
win-condition mechanic. The play screen (`playFeedHtml`) shows a per-player status
row (their clue / "…" typing / "Up next" / "Killed"); the vote screen shows each
player's clue, a running cumulative-vote badge, and Vote/Voted buttons; results
shows a coloured win/lose card + the reveal (role + Dead tags).

Each vote phase **auto-resolves after `VOTE_SECONDS` (30s, overridable via env
var for tests)** even if not everyone voted — `scheduleVoteTimeout`. The timer
lives on the round object; every resolution path (`resolveVote`, `endGame`)
clears it, and callbacks check `room.round === r` so a stale timeout can't act on
a fresh game after `again`.

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

**Invite links (deep-link):** Share builds `online.html?room=CODE`. On load the
`resume()` IIFE parses `?room=`, switches to join mode + prefills the code, and
auto-joins if a name is already saved (else focuses the name field). It clears the
query with `history.replaceState` so a refresh won't re-fire. An existing saved
session takes priority over the link.

**Note:** `pass-and-play` (`index.html`) still uses the OLDER single-round rules —
the vote-every-round elimination rework is **online only** so far. If you touch
game rules, remember the two are now different.

---

## Design system

**Light "esports" theme — red / white / blue**, pulled from the NOCAP logo. Clean
white surfaces, bold red primary, blue for the civilian role, squared game type.

- Background: near-white `#F5F7FB` (`--ink`) with faint red + blue radial tints
  and a barely-there dark grid. Cards (`--surface` `#FFFFFF`) sit on it with soft
  shadows (no glow — glow is a dark-theme thing, don't add it here).
- Role / brand colors:
  - **Brand + primary + imposter = RED** `#E11D2A` — this is the `--gold*` token
    set (buttons, generic accents, and the imposter role/`--crimson*`, all red).
  - **Civilian = BLUE** `#1E7FE0` — the `--blue*` tokens. Only the civilian-role
    selectors use blue (`.card.civ*`, `.secret.civ*`, `.role.r-civ`); everything
    else "accent" is red.
  - Accent as a *fill* uses **white** text (`#FFFFFF`); accent as *text on white*
    uses the readable `--gold-ink` `#C4141F` (red) or `--blue-ink` `#1568C4` (blue).
- **Token names are inherited, not accurate:** `--gold*` = brand RED, `--crimson*`
  = imposter red, `--blue*` = civilian blue, `--cream` (`#16181F`) = dark primary
  text, `--ink*`/`--surface*` = light. Kept the old names so the hundreds of
  `var(--…)` usages across the two duplicated files didn't need renaming. To
  re-theme, remap the `:root` block in **both** `index.html` and `online.html`,
  the `<meta name="theme-color">`, and `manifest.json` — plus the hardcoded
  literals: `fill="#E11D2A"` logo mask, flip-card light gradients, the avatar `AV`
  palette (medium-saturation, white-text-friendly), and `#FFFFFF` accent-text. The
  bulk tints are `rgba(225,29,42,…)` (red), `rgba(30,127,224,…)` (blue),
  `rgba(43,227,138,…)` (green).
- ⚠️ **Comment trap:** never write `*/` inside a CSS comment (e.g. describing
  `var(--gold-*/-something)`). It closes the comment early and silently corrupts
  the next declarations — this bug once made `--ink` resolve to empty and the
  whole background render white. The `:root` comment is written to avoid it.
- **Logo:** the header shows an `<img class="brand-logo" src="icons/nocap-logo.png">`
  with `onerror` that hides it and falls back to the `.brand-txt` "NOCAP" wordmark.
  The user supplies the PNG; it may 404 in dev (harmless).
- Type: **Orbitron** (display/headings/buttons — the esports look) / **Rajdhani**
  (body/UI, runs light so body is `font-weight:500`) / **Share Tech Mono** (codes,
  timers, labels).
- Signature element: the flip card. Civ face = light with a blue word + blue
  border; imp face = light with a red "IMPOSTER".
- Toasts are a dark pill (`#17181F`) for contrast on the light UI.
- Mobile-first, safe-area aware, `prefers-reduced-motion` respected.
- `livetest.py` asserts `body` computes to `rgb(245, 247, 251)` and the `.brand-txt`
  says "nocap" — update them if those change.

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
