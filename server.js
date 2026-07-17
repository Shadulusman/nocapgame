/* =========================================================
   NOCAP · realtime game server (server-authoritative)
   Node + ws. Deploy anywhere that runs Node (Render, Railway,
   Fly, Glitch) or run locally with:  npm install && npm start
   ========================================================= */
const { WebSocketServer } = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const PORT = process.env.PORT || 8787;
// Hosts (Render/Railway/Fly) need 0.0.0.0. Use HOST=127.0.0.1 for local tests.
const HOST = process.env.HOST || "0.0.0.0";

/* ---- word data (server owns the secret; clients never see it early) ---- */
const CATEGORIES = [
  {id:"easy",emo:"🍎",name:"Easy Words",words:["Apple","Pizza","Dog","Cat","Car","Phone","Chair","Table","Book","School","Teacher","Doctor","House","Tree","Sun","Moon","Beach","Mountain","Cake","Ice Cream","Coffee","Bus","Train","Football","Camera","Clock","Window","Mirror","Umbrella","Backpack"]},
  {id:"trending",emo:"🔥",name:"Trending",words:["ChatGPT","TikTok","Instagram","Reels","Podcast","AI","Influencer","Crypto","Bitcoin","Meme","Viral","Netflix","Spotify","iPhone","Tesla","Drone","VR","Electric Car","Selfie","Hashtag","Livestream","YouTube Shorts","Creator","Emoji","Threads","Discord","Snapchat","Esports","Metaverse"]},
  {id:"world",emo:"🌍",name:"Around the World",words:["India","Japan","Brazil","France","Canada","Australia","Dubai","New York","Paris","London","Taj Mahal","Eiffel Tower","Great Wall","Mount Everest","Sahara","Amazon Rainforest","Antarctica","Niagara Falls","Bali","Maldives","Rome","Tokyo","Sydney","Singapore","Iceland","Venice","Swiss Alps","Pyramids","Statue of Liberty","Burj Khalifa"]},
  {id:"ent",emo:"🎬",name:"Entertainment",words:["Avengers","Batman","Superman","Harry Potter","Spider-Man","Iron Man","Shrek","Frozen","Minions","Lion King","Friends","Breaking Bad","Money Heist","Stranger Things","Squid Game","Interstellar","Titanic","Avatar","John Wick","Mission Impossible","Naruto","One Piece","Pokemon","Minecraft","GTA","BGMI","Free Fire","Valorant","Mario","SpongeBob"]},
  {id:"everyday",emo:"🧴",name:"Everyday Things",words:["Toothbrush","Pillow","Soap","Shampoo","Remote","TV","Laptop","Keyboard","Mouse","Wallet","Keys","Bottle","Spoon","Fork","Knife","Plate","Pan","Microwave","Fridge","Fan","AC","Light Bulb","Curtain","Bucket","Mug","Scissors","Pen","Notebook","Helmet","Watch"]},
  {id:"animals",emo:"🦁",name:"Animals & Nature",words:["Lion","Tiger","Elephant","Giraffe","Penguin","Kangaroo","Koala","Panda","Wolf","Fox","Bear","Monkey","Horse","Cow","Goat","Rabbit","Snake","Crocodile","Shark","Dolphin","Whale","Octopus","Peacock","Eagle","Parrot","Rose","Sunflower","Coconut Tree","Bamboo","Volcano"]},
  {id:"sports",emo:"⚽",name:"Sports & Leisure",words:["Cricket","Football","Tennis","Basketball","Volleyball","Badminton","Chess","Swimming","Golf","Hockey","Messi","Ronaldo","Virat Kohli","MS Dhoni","Sachin Tendulkar","Neeraj Chopra","Olympics","World Cup","IPL","Wimbledon","Penalty","Goalkeeper","Bat","Helmet","Referee","Gym","Yoga","Cycling","Running","Skateboard"]},
  {id:"school",emo:"🎒",name:"School",words:["Principal","Teacher","Student","Homework","Exam","Blackboard","Chalk","Pencil","Notebook","Lunch Box","Uniform","Library","Science Lab","Math","History","Geography","Biology","Chemistry","Physics","Calculator","Project","Report Card","Classroom","Desk","Backpack","Compass","Glue","Marker","Whiteboard","Graduation"]},
  {id:"celebration",emo:"🎉",name:"Celebrations",words:["Birthday","Wedding","Diwali","Eid","Christmas","New Year","Halloween","Holi","Onam","Vishu","Thanksgiving","Anniversary","Baby Shower","Fireworks","Gift","Cake","Party","Balloon","Confetti","Music","Dance","DJ","Festival","Carnival","Lantern","Decoration","Family Dinner","Vacation","Parade","Picnic"]},
  {id:"celebs",emo:"⭐",name:"Celebrities",words:["Shah Rukh Khan","Salman Khan","Aamir Khan","Deepika Padukone","Alia Bhatt","Ranbir Kapoor","Rajinikanth","Allu Arjun","Mohanlal","Mammootty","Prabhas","Yash","Virat Kohli","MS Dhoni","Sachin Tendulkar","Cristiano Ronaldo","Lionel Messi","Taylor Swift","Ed Sheeran","Justin Bieber","Dwayne Johnson","Tom Cruise","Emma Watson","Robert Downey Jr.","Chris Hemsworth","Zendaya","MrBeast","PewDiePie","Elon Musk","Mark Zuckerberg"]},
];
const CAT_INDEX = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
const PUBLIC_CATS = CATEGORIES.map(c => ({ id:c.id, emo:c.emo, name:c.name, count:c.words.length }));

/* ---- helpers ---- */
const rand = a => a[Math.floor(Math.random() * a.length)];
// Fisher-Yates. `arr.sort(() => Math.random() - .5)` looks like a shuffle but is
// heavily biased on small arrays (V8's sort keeps early elements disproportionately
// in place) — that's why the same player kept ending up as the imposter.
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const MAX_PLAYERS = 12;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({length:4}, () => rand([...CODE_CHARS])).join("");
const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => Date.now();

const rooms = new Map();

function makeRoom(hostId) {
  return {
    code: (() => { let c; do { c = newCode(); } while (rooms.has(c)); return c; })(),
    hostId,
    founderId: hostId,   // the creator — reclaims host when they reconnect
    status: "lobby",
    isPublic: false,     // private by default; only public rooms show in the browser
    createdAt: now(),
    settings: {
      categories: CATEGORIES.map(c => c.id),
      imposters: 1,
      rounds: 2,
      seeCat: true,
      hint: true,
      chat: true,
    },
    players: new Map(), // id -> {id,name,ws,connected,alive}
    round: null,
    chat: [],            // {id,name,text,ts} — last CHAT_KEEP kept
    autoStartAt: null,   // ms timestamp the lobby auto-start fires, or null
    autoStartTimer: null,
  };
}

function sanitize(room, pid) {
  const isHost = room.hostId === pid;
  const players = [...room.players.values()].map(p => ({
    id: p.id, name: p.name, connected: p.connected, isHost: p.id === room.hostId,
  }));
  const base = {
    type: "state",
    code: room.code,
    status: room.status,
    youId: pid,
    isHost,
    settings: room.settings,
    catalog: PUBLIC_CATS,
    players,
    // In-game chat (host can disable). Kept small; broadcast with each snapshot.
    chat: room.settings.chat ? room.chat.slice(-CHAT_KEEP).map(c => ({ id: c.id, name: c.name, text: c.text })) : [],
    // Lobby auto-start countdown deadline (ms) so clients can render "Starts in 0:58".
    autoStartAt: room.status === "lobby" ? room.autoStartAt : null,
  };
  if (room.status === "playing" || room.status === "voting") {
    const r = room.round;
    const amImp = r.imposterIds.has(pid);
    const turnId = r.order[r.turnIndex];
    const alive = new Set(aliveIds(room));
    const liveVotes = room.status === "voting" ? voteCounts(room) : new Map(); // this round's live tally
    base.round = {
      phase: room.status,                         // "playing" | "voting"
      turnPlayerId: room.status === "playing" ? turnId : null,
      turnName: room.status === "playing" && room.players.get(turnId) ? room.players.get(turnId).name : null,
      turnDeadline: room.status === "playing" ? (r.turnDeadline || null) : null,  // ms — per-turn 40s clock
      roundNo: r.roundNo,
      imposters: r.imposterIds.size,
      // roster in turn order — each player's alive/dead + connection + LIVE votes this round.
      // NOTE: never leak who the imposter is here.
      order: r.order.map(id => {
        const p = room.players.get(id);
        return {
          id, name: p ? p.name : "?",
          connected: p ? p.connected : false,
          dead: r.dead.has(id),
          votes: liveVotes.get(id) || 0,          // LIVE votes this round (updates as people vote)
          gone: !p,                               // kicked / left entirely
        };
      }),
      turnIndex: r.turnIndex,
      clues: r.clues.map(c => ({ playerId: c.playerId, name: c.name, words: c.words, roundNo: c.roundNo })),
      yourRole: amImp ? "imposter" : "civilian",
      yourWord: amImp ? null : r.word,
      yourAlive: !r.dead.has(pid),
      category: r.catName,
      yourHint: amImp ? { category: room.settings.seeCat ? r.catName : null, words: room.settings.hint ? r.hintWords : null } : null,
      voting: room.status === "voting",
      votesIn: r.votes.size,
      totalVoters: [...alive].filter(id => room.players.get(id) && room.players.get(id).connected).length,
      yourVote: r.votes.get(pid) || null,
      voteDeadline: r.voteDeadline || null,
    };
  }
  if (room.status === "results") {
    const r = room.round;
    base.results = r.result;
    base.round = { yourRole: r.imposterIds.has(pid) ? "imposter" : "civilian", category: r.catName };
  }
  return base;
}

function broadcast(room) {
  for (const p of room.players.values()) {
    if (p.connected && p.ws.readyState === 1) {
      try { p.ws.send(JSON.stringify(sanitize(room, p.id))); } catch (e) {}
    }
  }
}
function sendErr(ws, msg) { try { ws.send(JSON.stringify({ type: "error", message: msg })); } catch (e) {} }

function startRound(room) {
  cancelAutoStart(room); // game is starting — no dangling lobby countdown
  const pool = CATEGORIES.filter(c => room.settings.categories.includes(c.id));
  const cat = rand(pool.length ? pool : CATEGORIES);
  const word = rand(cat.words);
  const decoys = shuffle(cat.words.filter(w => w !== word));
  const hintWords = decoys.slice(0, 3);

  const ids = [...room.players.keys()];
  const impCount = Math.min(room.settings.imposters, Math.max(1, ids.length - 2));
  // Random, but avoid making the same player(s) the imposter two games running —
  // pick from those who WEREN'T imposter last game first, then fall back if needed.
  // (Fixes the "same person is always the imposter" feeling; still uniform-ish.)
  const last = room.lastImposters || new Set();
  const fresh = shuffle(ids.filter(id => !last.has(id)));
  const repeats = shuffle(ids.filter(id => last.has(id)));
  const imposterIds = new Set([...fresh, ...repeats].slice(0, impCount));
  room.lastImposters = new Set(imposterIds);

  room.round = {
    word, catId: cat.id, catName: cat.name, hintWords,
    imposterIds,
    order: shuffle(ids),
    turnIndex: 0,
    roundNo: 1,          // game rounds: clue pass + vote, repeats until a side wins
    clues: [],
    votes: new Map(),    // current vote phase: voterId -> targetId
    tally: new Map(),    // CUMULATIVE votes received across rounds: id -> count
    dead: new Set(),     // eliminated player ids
    deaths: [],          // [{id, roundNo}] in elimination order (for the reveal)
    result: null,
  };
  room.status = "playing";
  skipUnavailableTurns(room);
}

// alive = still in the game (not eliminated) and present as a player.
const aliveIds = room => room.round.order.filter(id => room.players.has(id) && !room.round.dead.has(id));
const aliveImposters = room => aliveIds(room).filter(id => room.round.imposterIds.has(id));
const aliveCivilians = room => aliveIds(room).filter(id => !room.round.imposterIds.has(id));
// can act this instant: alive, connected, and (for turns) it's a real player
const isAvailable = (room, id) => {
  const p = room.players.get(id);
  return !!p && p.connected && !room.round.dead.has(id);
};

// Advance turnIndex to the next alive+connected player; if the clue pass is done
// (or nobody can act), move on to the vote phase.
function skipUnavailableTurns(room) {
  const r = room.round;
  let guard = 0;
  while (guard++ <= r.order.length) {
    if (r.turnIndex >= r.order.length) { startVotePhase(room); return; }
    if (isAvailable(room, r.order[r.turnIndex])) { startTurnTimer(room); return; }
    r.turnIndex++;
  }
  startVotePhase(room);
}

const VOTE_SECONDS = Number(process.env.VOTE_SECONDS) || 30; // override in tests only
const TURN_SECONDS = Number(process.env.TURN_SECONDS) || 40; // max time to type a clue word
const LOBBY_SECONDS = Number(process.env.LOBBY_SECONDS) || 60; // public-room auto-start

// Each player gets TURN_SECONDS to type their clue. If they don't, their turn is
// auto-skipped ("Skipped") and play moves on — one slow/AFK player can't stall.
function clearTurnTimer(room) {
  if (room.round && room.round.turnTimer) { clearTimeout(room.round.turnTimer); room.round.turnTimer = null; }
}
function startTurnTimer(room) {
  clearTurnTimer(room);
  const r = room.round;
  r.turnDeadline = now() + TURN_SECONDS * 1000;
  r.turnTimer = setTimeout(() => {
    if (room.round !== r || room.status !== "playing") return;
    const id = r.order[r.turnIndex];
    if (isAvailable(room, id)) {
      r.clues.push({ playerId: id, name: room.players.get(id).name, words: ["Skipped"], roundNo: r.roundNo, skipped: true });
    }
    advanceTurn(room);
    broadcast(room);
  }, TURN_SECONDS * 1000);
}
const CHAT_KEEP = 50;         // most recent chat messages retained per room
const CHAT_MAX_LEN = 160;
const CHAT_MIN_GAP = 350;     // ms between a player's messages (light rate limit)

const connectedCount = room => [...room.players.values()].filter(p => p.connected).length;

// A lobby with 3+ connected players auto-starts after LOBBY_SECONDS (the "Starts
// in 0:58" countdown on public room cards). The host can start early; if players
// drop below 3 the countdown cancels. Timer + deadline live on the room and are
// always cleared through cancelAutoStart so a stale one can't fire into a game.
function cancelAutoStart(room) {
  if (room.autoStartTimer) { clearTimeout(room.autoStartTimer); room.autoStartTimer = null; }
  room.autoStartAt = null;
}
function refreshAutoStart(room) {
  if (room.status !== "lobby") { cancelAutoStart(room); return; }
  const enough = connectedCount(room) >= 3;
  if (enough && !room.autoStartTimer) {
    room.autoStartAt = now() + LOBBY_SECONDS * 1000;
    room.autoStartTimer = setTimeout(() => {
      room.autoStartTimer = null; room.autoStartAt = null;
      if (room.status === "lobby" && connectedCount(room) >= 3) {
        startRound(room);
        broadcast(room);
      }
    }, LOBBY_SECONDS * 1000);
  } else if (!enough && room.autoStartTimer) {
    cancelAutoStart(room);
  }
}

// Voting auto-resolves after VOTE_SECONDS even if not everyone has voted, so a
// slow or absent voter can't stall the group forever. The timer lives on the
// round object (not the room) so a stale timeout from an earlier round — e.g.
// after "again" starts a fresh round with its own new round object and timer —
// checks `room.round === r` and no-ops instead of tallying the wrong round.
function scheduleVoteTimeout(room) {
  const r = room.round;
  r.voteDeadline = now() + VOTE_SECONDS * 1000;
  r.voteTimer = setTimeout(() => {
    if (room.round === r && room.status === "voting") {
      resolveVote(room);
      broadcast(room);
    }
  }, VOTE_SECONDS * 1000);
}

// After the clue pass, everyone alive votes. Votes pile onto the cumulative tally.
function startVotePhase(room) {
  clearTurnTimer(room);
  room.round.turnDeadline = null;
  room.status = "voting";
  room.round.votes = new Map();
  scheduleVoteTimeout(room);
}

function advanceTurn(room) {
  room.round.turnIndex++;
  skipUnavailableTurns(room);
}

// Resolve a voting phase under PLURALITY: the single most-voted alive player is
// eliminated (a tie for the top → nobody goes out), then check win conditions.
// Civilians win when all imposters are out; imposters win when they equal/outnumber
// remaining civilians; otherwise a new clue round starts.
// count THIS round's votes: targetId -> number of votes
function voteCounts(room) {
  const c = new Map();
  for (const target of room.round.votes.values()) c.set(target, (c.get(target) || 0) + 1);
  return c;
}

function resolveVote(room) {
  const r = room.round;
  if (r.voteTimer) { clearTimeout(r.voteTimer); r.voteTimer = null; }
  const counts = voteCounts(room);
  for (const [id, v] of counts) r.tally.set(id, (r.tally.get(id) || 0) + v); // running total, for the reveal
  // Eliminate the single player with the MOST votes this round (plurality). A tie
  // for the top → nobody goes out. (e.g. a=2, b=1, c=1 → a is out; a=2, b=2 → nobody.)
  let topId = null, max = 0, tie = false;
  for (const id of aliveIds(room)) {
    const v = counts.get(id) || 0;
    if (v > max) { max = v; topId = id; tie = false; }
    else if (v === max && max > 0) tie = true;
  }
  const eliminated = (topId && max > 0 && !tie) ? [topId] : [];
  for (const id of eliminated) { r.dead.add(id); r.deaths.push({ id, roundNo: r.roundNo }); }
  r.lastEliminated = eliminated;

  const impAlive = aliveImposters(room).length;
  const civAlive = aliveCivilians(room).length;
  if (impAlive === 0) return endGame(room, "civilians");
  if (impAlive >= civAlive) return endGame(room, "imposters");

  // no winner yet — go around again
  r.roundNo++;
  r.votes = new Map();
  r.turnIndex = 0;
  room.status = "playing";
  skipUnavailableTurns(room);
}

// Resolve the current vote as soon as every alive+connected player has voted.
function maybeResolveVotes(room) {
  if (room.status !== "voting" || !room.round) return;
  const alive = aliveIds(room);
  const voters = alive.filter(id => room.players.get(id) && room.players.get(id).connected).length;
  if (voters > 0 && room.round.votes.size >= voters) resolveVote(room);
}

function endGame(room, winner) {
  const r = room.round;
  if (r.voteTimer) { clearTimeout(r.voteTimer); r.voteTimer = null; }
  clearTurnTimer(room);
  r.result = {
    winner,                                  // "civilians" | "imposters"
    word: r.word,
    catName: r.catName,
    imposterIds: [...r.imposterIds],
    lastEliminated: r.lastEliminated || [],
    players: r.order.map(id => {
      const p = room.players.get(id);
      return {
        id, name: p ? p.name : "—",
        role: r.imposterIds.has(id) ? "imposter" : "civilian",
        dead: r.dead.has(id),
        votes: r.tally.get(id) || 0,
      };
    }),
    clues: r.clues.map(c => ({ name: c.name, words: c.words })),
  };
  room.status = "results";
}

function reassignHostIfNeeded(room) {
  const host = room.players.get(room.hostId);
  if (host && host.connected) return;
  const next = [...room.players.values()].find(p => p.connected);
  if (next) room.hostId = next.id;
}

/* ---- server ---- */
/* ---- static file serving: the same deploy hosts the game AND the app ---- */
const MIME = {
  ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8",
  ".png":"image/png", ".svg":"image/svg+xml", ".ico":"image/x-icon",
  ".webmanifest":"application/manifest+json",
};
// gzip these text types (the HTML files are ~60–80KB → ~15KB gzipped). PNGs are
// already compressed, so we never re-gzip them.
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg", ".webmanifest"]);
function cacheHeader(ext, urlPath) {
  if (ext === ".png" || ext === ".ico") return "public, max-age=604800";  // icons — a week
  if (urlPath === "/manifest.json") return "public, max-age=86400";       // a day
  if (urlPath === "/sw.js") return "no-cache";  // let the browser detect SW updates
  return "no-cache";                            // HTML — revalidate so edits show up
}
const ROOT = __dirname;
const httpServer = http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/" ) urlPath = "/index.html";
  if (urlPath === "/health") { res.writeHead(200); return res.end("ok"); }
  // Public room browser: list open (lobby-status) rooms so anyone can join without
  // needing a code. Room codes are already meant to be shareable, so this data
  // isn't sensitive — CORS is open to keep working from a standalone-opened file.
  if (urlPath === "/rooms") {
    const open = [...rooms.values()]
      .filter(r => r.isPublic && (r.status === "lobby" || r.status === "playing" || r.status === "voting"))
      .map(r => {
        const conn = [...r.players.values()].filter(p => p.connected);
        const joinable = r.status === "lobby" && conn.length < MAX_PLAYERS;
        return {
          code: r.code,
          hostName: (r.players.get(r.hostId) || {}).name || "?",
          players: conn.length,
          maxPlayers: MAX_PLAYERS,
          imposters: r.settings.imposters,
          names: conn.slice(0, 6).map(p => p.name),      // for the avatar row
          cats: r.settings.categories.length,             // for the category chip
          cat1: (CAT_INDEX[r.settings.categories[0]] || {}).name || "Mixed",
          autoStartAt: r.status === "lobby" ? (r.autoStartAt || null) : null,
          status: r.status,                               // lobby | playing | voting
          inGame: r.status !== "lobby",                   // show "In game", not joinable
          joinable,
        };
      })
      .filter(r => r.players > 0)
      .sort((a, b) => (a.joinable === b.joinable) ? b.players - a.players : (a.joinable ? -1 : 1))
      .slice(0, 30);
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
    return res.end(JSON.stringify(open));
  }
  // block path traversal
  const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, ""));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, {"Content-Type":"text/plain"}); return res.end("Not found"); }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": cacheHeader(ext, urlPath),
    };
    const acceptsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
    if (acceptsGzip && COMPRESSIBLE.has(ext)) {
      zlib.gzip(data, (gzErr, gz) => {
        if (gzErr) { res.writeHead(200, headers); return res.end(data); }
        headers["Content-Encoding"] = "gzip";
        headers["Vary"] = "Accept-Encoding";
        res.writeHead(200, headers);
        res.end(gz);
      });
    } else {
      res.writeHead(200, headers);
      res.end(data);
    }
  });
});
const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(PORT, HOST);
console.log(`NOCAP server listening on ${HOST}:${PORT}`);

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  let pid = null, roomCode = null;

  ws.on("message", (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const t = msg.type;

    if (t === "create") {
      const name = String(msg.name || "").trim().slice(0, 14) || "Player";
      pid = uid();
      const room = makeRoom(pid);
      room.isPublic = !!msg.public;   // "Create public room" lists it in the browser
      room.players.set(pid, { id: pid, name, ws, connected: true });
      rooms.set(room.code, room);
      roomCode = room.code;
      ws.send(JSON.stringify({ type: "joined", code: room.code, youId: pid }));
      broadcast(room);
      return;
    }

    if (t === "join") {
      const code = String(msg.code || "").toUpperCase().trim();
      const name = String(msg.name || "").trim().slice(0, 14) || "Player";
      const room = rooms.get(code);
      if (!room) return sendErr(ws, "No room with that code.");
      if (room.status !== "lobby") return sendErr(ws, "That game already started.");
      if (room.players.size >= MAX_PLAYERS) return sendErr(ws, `Room is full (${MAX_PLAYERS} max).`);
      pid = uid();
      room.players.set(pid, { id: pid, name, ws, connected: true });
      roomCode = code;
      ws.send(JSON.stringify({ type: "joined", code, youId: pid }));
      refreshAutoStart(room);
      broadcast(room);
      return;
    }

    if (t === "rejoin") {
      const code = String(msg.code || "").toUpperCase().trim();
      const room = rooms.get(code);
      if (!room || !room.players.has(msg.youId)) return sendErr(ws, "Couldn't rejoin — room gone.");
      pid = msg.youId; roomCode = code;
      const p = room.players.get(pid);
      p.ws = ws; p.connected = true;
      // The original creator reclaims host when they come back online — host only
      // migrated away because they dropped. (Only same-identity reconnects reach
      // here; someone who intentionally left cleared their session and can't.)
      if (pid === room.founderId) room.hostId = pid;
      refreshAutoStart(room);
      ws.send(JSON.stringify({ type: "joined", code, youId: pid }));
      broadcast(room);
      return;
    }

    const room = rooms.get(roomCode);
    if (!room || !pid) return;

    if (t === "settings" && room.hostId === pid && room.status === "lobby") {
      const s = room.settings, m = msg.settings || {};
      if (Array.isArray(m.categories)) s.categories = m.categories.filter(id => CAT_INDEX[id]);
      if (s.categories.length === 0) s.categories = CATEGORIES.map(c => c.id);
      if (Number.isInteger(m.imposters)) s.imposters = Math.max(1, Math.min(2, m.imposters));
      if (Number.isInteger(m.rounds)) s.rounds = Math.max(1, Math.min(3, m.rounds));
      if (typeof m.seeCat === "boolean") s.seeCat = m.seeCat;
      if (typeof m.hint === "boolean") s.hint = m.hint;
      if (typeof m.chat === "boolean") s.chat = m.chat;
      broadcast(room);
      return;
    }

    if (t === "chat") {
      if (!room.settings.chat) return;                     // host disabled chat
      if (room.status !== "lobby" && room.status !== "playing" && room.status !== "voting") return;
      const p = room.players.get(pid);
      if (!p) return;
      const nowMs = now();
      if (p.lastChat && nowMs - p.lastChat < CHAT_MIN_GAP) return; // light rate limit
      const text = String(msg.text || "").replace(/\s+/g, " ").trim().slice(0, CHAT_MAX_LEN);
      if (!text) return;
      p.lastChat = nowMs;
      room.chat.push({ id: uid(), name: p.name, text, ts: nowMs });
      if (room.chat.length > CHAT_KEEP) room.chat = room.chat.slice(-CHAT_KEEP);
      broadcast(room);
      return;
    }

    if (t === "voice") {
      // push-to-talk walkie-talkie: relay a short recorded clip to everyone else in
      // the room. Not stored in state (broadcast() would re-send it) — pushed once.
      if (room.status === "lobby") return;               // only meaningful in-game
      const p = room.players.get(pid);
      if (!p) return;
      const nowMs = now();
      if (p.lastVoice && nowMs - p.lastVoice < 300) return; // light flood guard
      p.lastVoice = nowMs;
      const audio = String(msg.audio || "");
      if (!audio || audio.length > 400000) return;        // ~300KB cap on the clip
      const payload = JSON.stringify({ type: "voice", from: pid, name: p.name, mime: String(msg.mime || "audio/webm").slice(0, 40), audio });
      for (const o of room.players.values()) {
        if (o.id !== pid && o.connected && o.ws.readyState === 1) {
          try { o.ws.send(payload); } catch (e) {}
        }
      }
      return;
    }

    if (t === "start" && room.hostId === pid && room.status === "lobby") {
      if (room.players.size < 3) return sendErr(ws, "Need at least 3 players.");
      startRound(room);
      broadcast(room);
      return;
    }

    if (t === "clue" && room.status === "playing") {
      const r = room.round;
      if (r.order[r.turnIndex] !== pid || !isAvailable(room, pid)) return sendErr(ws, "Not your turn.");
      let words = Array.isArray(msg.words) ? msg.words : [];
      words = words.map(w => String(w || "").trim().slice(0, 22)).filter(Boolean).slice(0, 1);
      if (words.length === 0) return sendErr(ws, "Type your clue word.");
      r.clues.push({ playerId: pid, name: room.players.get(pid).name, words, roundNo: r.roundNo });
      advanceTurn(room);
      broadcast(room);
      return;
    }

    if (t === "vote" && room.status === "voting") {
      const r = room.round;
      if (!isAvailable(room, pid)) return;                     // eliminated / gone can't vote
      const alive = aliveIds(room);
      if (!alive.includes(msg.targetId)) return;               // can only vote a living player
      r.votes.set(pid, msg.targetId);
      const voters = alive.filter(id => room.players.get(id).connected).length;
      if (r.votes.size >= voters) resolveVote(room);
      broadcast(room);
      return;
    }

    if (t === "forceReveal" && room.hostId === pid && room.status === "voting") {
      resolveVote(room);   // resolve this round's vote now (may or may not end the game)
      broadcast(room);
      return;
    }

    if (t === "kick" && room.hostId === pid) {
      const target = room.players.get(msg.targetId);
      if (!target || target.id === pid) return;   // can't kick yourself / nobody
      try { target.ws.send(JSON.stringify({ type: "kicked" })); } catch (e) {}
      try { target.ws.close(); } catch (e) {}
      room.players.delete(msg.targetId);
      if (room.round) { room.round.dead.add(msg.targetId); }   // drop out of any running game
      reassignHostIfNeeded(room);
      refreshAutoStart(room);
      if (room.status === "playing" && room.round.order[room.round.turnIndex] === msg.targetId) skipUnavailableTurns(room);
      if (room.status === "voting") maybeResolveVotes(room);
      broadcast(room);
      return;
    }

    if (t === "again" && room.hostId === pid && room.status === "results") {
      if (room.players.size < 3) { room.status = "lobby"; refreshAutoStart(room); broadcast(room); return; }
      startRound(room);
      broadcast(room);
      return;
    }

    if (t === "backToLobby" && room.hostId === pid) {
      room.status = "lobby"; room.round = null;
      refreshAutoStart(room);
      broadcast(room);
      return;
    }
  });

  ws.on("close", () => {
    const room = rooms.get(roomCode);
    if (!room || !pid) return;
    const p = room.players.get(pid);
    // A newer connection (rejoin) may have already replaced this socket for the
    // same player — a stale close event firing after that would otherwise mark
    // a still-connected player as disconnected, wrongly migrate host, and cause
    // broadcast() to skip them until they refresh.
    if (!p || p.ws !== ws) return;
    p.connected = false;

    // If everyone gone, clean up after a grace period
    const anyConnected = [...room.players.values()].some(x => x.connected);
    if (!anyConnected) {
      setTimeout(() => {
        const rm = rooms.get(roomCode);
        if (rm && ![...rm.players.values()].some(x => x.connected)) rooms.delete(roomCode);
      }, 60000);
      return;
    }
    reassignHostIfNeeded(room);
    // dropping below 3 in the lobby cancels the auto-start countdown
    refreshAutoStart(room);
    // if it was this player's turn, skip on
    if (room.status === "playing" && room.round.order[room.round.turnIndex] === pid) {
      skipUnavailableTurns(room);
    }
    // if the drop means everyone still present has voted, resolve now
    maybeResolveVotes(room);
    broadcast(room);
  });
});

/* heartbeat to drop dead sockets */
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 30000);

