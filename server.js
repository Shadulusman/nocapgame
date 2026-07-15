/* =========================================================
   BHEDI · realtime game server (server-authoritative)
   Node + ws. Deploy anywhere that runs Node (Render, Railway,
   Fly, Glitch) or run locally with:  npm install && npm start
   ========================================================= */
const { WebSocketServer } = require("ws");
const http = require("http");
const fs = require("fs");
const path = require("path");
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
    status: "lobby",
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
    base.round = {
      turnPlayerId: room.status === "playing" ? turnId : null,
      turnName: room.status === "playing" && room.players.get(turnId) ? room.players.get(turnId).name : null,
      roundNo: r.roundNo + 1,
      roundsTotal: room.settings.rounds,
      order: r.order.map(id => ({
        id, name: room.players.get(id) ? room.players.get(id).name : "?",
        connected: room.players.get(id) ? room.players.get(id).connected : false,
      })),
      turnIndex: r.turnIndex,
      clues: r.clues.map(c => ({ playerId: c.playerId, name: c.name, words: c.words, roundNo: c.roundNo })),
      yourRole: amImp ? "imposter" : "civilian",
      yourWord: amImp ? null : r.word,
      category: r.catName,
      yourHint: amImp ? { category: room.settings.seeCat ? r.catName : null, words: room.settings.hint ? r.hintWords : null } : null,
      voting: room.status === "voting",
      votesIn: r.votes.size,
      totalVoters: players.filter(p => p.connected).length,
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
  const shuffledForImposter = shuffle(ids);
  const impCount = Math.min(room.settings.imposters, Math.max(1, ids.length - 2));
  const imposterIds = new Set(shuffledForImposter.slice(0, impCount));

  room.round = {
    word, catId: cat.id, catName: cat.name, hintWords,
    imposterIds,
    order: shuffle(ids),
    turnIndex: 0,
    roundNo: 0,
    clues: [],
    votes: new Map(),
    result: null,
  };
  room.status = "playing";
  skipDisconnectedTurns(room);
}

function skipDisconnectedTurns(room) {
  const r = room.round;
  let guard = 0;
  while (guard++ < r.order.length) {
    const cur = room.players.get(r.order[r.turnIndex]);
    if (cur && cur.connected) return;
    advanceTurn(room, true);
    if (room.status !== "playing") return;
  }
}

const VOTE_SECONDS = Number(process.env.VOTE_SECONDS) || 30; // override in tests only
const LOBBY_SECONDS = Number(process.env.LOBBY_SECONDS) || 60; // public-room auto-start
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
      tallyAndFinish(room);
      broadcast(room);
    }
  }, VOTE_SECONDS * 1000);
}

function advanceTurn(room, silent) {
  const r = room.round;
  r.turnIndex++;
  if (r.turnIndex >= r.order.length) {
    r.turnIndex = 0;
    r.roundNo++;
    if (r.roundNo >= room.settings.rounds) {
      room.status = "voting";
      scheduleVoteTimeout(room);
      return;
    }
  }
  if (!silent) skipDisconnectedTurns(room);
}

function tallyAndFinish(room) {
  const r = room.round;
  if (r.voteTimer) { clearTimeout(r.voteTimer); r.voteTimer = null; }
  const counts = new Map();
  for (const target of r.votes.values()) counts.set(target, (counts.get(target) || 0) + 1);
  let votedOutId = null, max = 0, tie = false;
  for (const [id, c] of counts) {
    if (c > max) { max = c; votedOutId = id; tie = false; }
    else if (c === max) tie = true;
  }
  if (tie) votedOutId = null;
  const votedOutIsImp = votedOutId != null && r.imposterIds.has(votedOutId);
  const imposterWon = !votedOutIsImp; // caught an imposter => civilians win
  r.result = {
    word: r.word,
    catName: r.catName,
    votedOutId,
    votedOutName: votedOutId ? (room.players.get(votedOutId)?.name || "—") : null,
    imposterWon,
    imposterIds: [...r.imposterIds],
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name,
      role: r.imposterIds.has(p.id) ? "imposter" : "civilian",
      votes: counts.get(p.id) || 0,
    })),
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
      .filter(r => r.status === "lobby")
      .map(r => {
        const conn = [...r.players.values()].filter(p => p.connected);
        return {
          code: r.code,
          hostName: (r.players.get(r.hostId) || {}).name || "?",
          players: conn.length,
          maxPlayers: MAX_PLAYERS,
          imposters: r.settings.imposters,
          names: conn.slice(0, 6).map(p => p.name),      // for the avatar row
          autoStartAt: r.autoStartAt || null,             // ms, drives "Starts in 0:58"
        };
      })
      .filter(r => r.players > 0 && r.players < r.maxPlayers)
      .sort((a, b) => b.players - a.players)
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
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server: httpServer });
httpServer.listen(PORT, HOST);
console.log(`Bhedi server listening on ${HOST}:${PORT}`);

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
      ws.send(JSON.stringify({ type: "joined", code, youId: pid }));
      refreshAutoStart(room);
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

    if (t === "start" && room.hostId === pid && room.status === "lobby") {
      if (room.players.size < 3) return sendErr(ws, "Need at least 3 players.");
      startRound(room);
      broadcast(room);
      return;
    }

    if (t === "clue" && room.status === "playing") {
      const r = room.round;
      if (r.order[r.turnIndex] !== pid) return sendErr(ws, "Not your turn.");
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
      if (!room.players.has(msg.targetId)) return;
      r.votes.set(pid, msg.targetId);
      const voters = [...room.players.values()].filter(p => p.connected).length;
      if (r.votes.size >= voters) tallyAndFinish(room);
      broadcast(room);
      return;
    }

    if (t === "forceReveal" && room.hostId === pid && room.status === "voting") {
      tallyAndFinish(room);
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
      skipDisconnectedTurns(room);
    }
    // if voting and this player leaving completes the vote
    if (room.status === "voting") {
      const voters = [...room.players.values()].filter(x => x.connected).length;
      if (room.round.votes.size >= voters && voters > 0) tallyAndFinish(room);
    }
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

