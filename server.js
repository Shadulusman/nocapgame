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
  {id:"bolly",emo:"🎬",name:"Bollywood",words:["Sholay","DDLJ","3 Idiots","Dangal","Baahubali","PK","Lagaan","Gully Boy","RRR","Pathaan","Jawan","Zindagi Na Milegi Dobara","Queen","Kahaani","Drishyam","Munna Bhai MBBS","Chak De India","Hera Pheri","Dil Chahta Hai","Swades","Rang De Basanti","Taare Zameen Par","Om Shanti Om","Bajrangi Bhaijaan","Kuch Kuch Hota Hai","KGF","Andaz Apna Apna","Golmaal","Barfi","Kabhi Khushi Kabhie Gham"]},
  {id:"food",emo:"🍛",name:"Indian Food",words:["Biryani","Butter Chicken","Masala Dosa","Idli","Samosa","Pani Puri","Chole Bhature","Paneer Tikka","Rajma Chawal","Dal Makhani","Pav Bhaji","Gulab Jamun","Jalebi","Rasgulla","Butter Naan","Aloo Paratha","Momos","Dhokla","Vada Pav","Misal Pav","Fish Curry","Appam","Puttu","Sambar","Rasam","Upma","Poha","Chai","Lassi","Kheer"]},
  {id:"festival",emo:"🎉",name:"Festivals",words:["Diwali","Holi","Eid","Onam","Pongal","Navratri","Durga Puja","Ganesh Chaturthi","Raksha Bandhan","Karva Chauth","Baisakhi","Christmas","Janmashtami","Makar Sankranti","Dussehra","Vishu","Ugadi","Bihu","Lohri","Chhath Puja"]},
  {id:"kerala",emo:"🌴",name:"Kerala Life",words:["Kathakali","Backwaters","Theyyam","Onam Sadya","Kasavu Saree","Snake Boat","Munnar","Toddy Shop","Banana Chips","Kerala Parotta","Beef Fry","Houseboat","Rubber Plantation","Ayurveda","Elephant Procession","Puttu & Kadala","Fish Molee","Nadan Chicken","Vembanad Lake","Coconut Tree"]},
  {id:"cricket",emo:"🏏",name:"Cricket",words:["Sachin Tendulkar","Virat Kohli","MS Dhoni","IPL","World Cup","Yorker","LBW","Wankhede","Eden Gardens","Rohit Sharma","Test Match","Googly","Century","Wicket","Bouncer","Chennai Super Kings","Mumbai Indians","Sixer","Umpire","Powerplay"]},
  {id:"fifa",emo:"⚽",name:"Football",words:["Messi","Ronaldo","Neymar","Mbappé","World Cup","Barcelona","Real Madrid","Penalty","Offside","Hat-trick","Goalkeeper","Free Kick","Champions League","Manchester United","Liverpool","Header","Corner Kick","Red Card","Golden Boot","Dribble"]},
  {id:"places",emo:"📍",name:"Places",words:["Taj Mahal","Gateway of India","Red Fort","Qutub Minar","Hawa Mahal","Golden Temple","India Gate","Charminar","Mysore Palace","Goa Beach","Kashmir Valley","Rajasthan Desert","Himalayas","Marina Beach","Marine Drive","Varanasi Ghats","Amber Fort","Hampi","Rann of Kutch","Andaman Islands"]},
  {id:"chars",emo:"🎯",name:"Characters",words:["Chhota Bheem","Doraemon","Shinchan","Motu Patlu","Hanuman","Ravana","Chulbul Pandey","Circuit","Gabbar Singh","Rancho","Simmba","Bajrangi","Kabir Singh","Jethalal","Babita","Daya","Little Krishna","Nagraj","Shaktimaan","Mr. India"]},
  {id:"gulf",emo:"✈️",name:"Gulf / NRI",words:["Dubai","Abu Dhabi","Visa Stamping","Passport","Remittance","Dirham","Riyal","Labour Camp","Emirates Flight","Gold Souk","Metro Card","Shawarma","Kabsa","Video Call Home","Excess Baggage","Duty Free","Iqama","Sponsor","Annual Vacation","Lulu Hypermarket"]},
  {id:"college",emo:"🎒",name:"College / School",words:["Attendance","Proxy","Canteen","Assignment","Backbench","Mass Bunk","Viva","Ragging","Internship","Hostel","Mess Food","Xerox Shop","Lab Record","Sports Day","Farewell","Placement","Fresher's Party","Semester Exam","Group Project","Fest"]},
  {id:"vehicles",emo:"🚌",name:"Vehicles",words:["Auto Rickshaw","Royal Enfield","Scooty","City Bus","Metro","Local Train","Cycle","Tractor","Ambassador","Maruti 800","Tempo","Bullock Cart","E-Rickshaw","Activa","Tata Nano","Ferry Boat","Sleeper Bus","Cycle Rickshaw","Jeep","Lorry"]},
  {id:"house",emo:"🏠",name:"Household",words:["Pressure Cooker","Mixer Grinder","Ceiling Fan","Steel Almirah","Bucket & Mug","Tulsi Plant","Inverter","Water Filter","Jhadu","Mosquito Net","Gas Stove","Tiffin Box","Air Cooler","Diya","Steel Glass","Casserole","Clothesline","Doormat","Pooja Shelf","Cot"]},
  {id:"people",emo:"👥",name:"People",words:["Doctor","Teacher","Auto Driver","Chaiwala","Watchman","Vegetable Vendor","Milkman","Priest","Barber","Tailor","Electrician","Plumber","Postman","Farmer","Shopkeeper","Traffic Police","Rickshaw Puller","News Anchor","Politician","Neighbour Aunty"]},
  {id:"funny",emo:"😂",name:"Desi Funny",words:["Sharma Ji Ka Beta","WhatsApp Forward","Log Kya Kahenge","Beta Engineer Banega","Rishtedaar","Shaadi Ka Card","Chai Break","Power Cut","Mummy Ka Chappal","Adjust Kar Lo","Bhai Discount De Do","Free WiFi","Ghar Ka Khana","Padhai Kar Le","Uncle Aunty","Traffic Jam","Kal Se Gym","Guest Aa Gaye","Netaji Ka Bhashan","Monday Morning"]},
  {id:"bakery",emo:"🥐",name:"Bakery",words:["Cream Bun","Egg Puff","Rusk","Dilkush","Bun Maska","Pastry","Fruit Cake","Cookie","Patties","Brownie","Croissant","Donut","Muffin","Cupcake","Toast","Samosa","Vanilla Slice","Black Forest","Coconut Biscuit","Jam Roll"]},
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
    },
    players: new Map(), // id -> {id,name,ws,connected,alive}
    round: null,
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
      .map(r => ({
        code: r.code,
        hostName: (r.players.get(r.hostId) || {}).name || "?",
        players: [...r.players.values()].filter(p => p.connected).length,
        maxPlayers: MAX_PLAYERS,
      }))
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
      if (room.players.size < 3) { room.status = "lobby"; broadcast(room); return; }
      startRound(room);
      broadcast(room);
      return;
    }

    if (t === "backToLobby" && room.hostId === pid) {
      room.status = "lobby"; room.round = null;
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

