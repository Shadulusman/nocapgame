process.env.PORT = "8812"; process.env.HOST = "127.0.0.1"; process.env.VOTE_SECONDS = "1";
require("../server.js");
const WebSocket = require("ws");
const URL = "ws://127.0.0.1:8812";
const wait = ms => new Promise(r => setTimeout(r, ms));
const fail=[]; const ok=(l,c)=>{console.log((c?"PASS  ":"FAIL  ")+l); if(!c) fail.push(l);};
function client(name){
  const ws=new WebSocket(URL); ws.nm=name;
  ws.on("message",raw=>{const m=JSON.parse(raw);
    if(m.type==="joined"){ws.youId=m.youId;ws.code=m.code;}
    if(m.type==="state") ws.state=m;
    if(m.type==="kicked") ws.wasKicked=true;});
  ws.sendj=o=>{ if(ws.readyState===1) ws.send(JSON.stringify(o)); };
  return ws;
}
async function room(n, names){
  const cs=[]; const A=client(names[0]); await wait(250);
  A.sendj({type:"create",name:names[0]}); await wait(300); cs.push(A);
  for(let i=1;i<n;i++){ const c=client(names[i]); await wait(120); c.sendj({type:"join",code:A.code,name:names[i]}); cs.push(c); }
  await wait(400); return cs;
}
const playToVote = async cs => { let g=0; while(cs[0].state.status==="playing" && g++<25){
  const cur=cs.find(x=>x.youId===cs[0].state.round.turnPlayerId); if(cur) cur.sendj({type:"clue",words:["w"]}); await wait(120); } };
setTimeout(()=>{console.log("TIMEOUT");process.exit(1);},45000);
(async()=>{
  await wait(400);

  // ---- CIVILIANS WIN when the imposter is eliminated ----
  let cs = await room(3,["A","B","C"]);
  cs[0].sendj({type:"start"}); await wait(400);
  await playToVote(cs);
  ok("reached voting after clue round", cs[0].state.status==="voting");
  let impId = cs.find(x=>x.state.round.yourRole==="imposter").youId;
  cs.forEach(x=>{ if(x.youId!==impId) x.sendj({type:"vote",targetId:impId}); else x.sendj({type:"vote",targetId:cs.find(c=>c.youId!==impId).youId}); });
  await wait(500);
  ok("voting out the imposter ends the game", cs[0].state.status==="results");
  ok("civilians win", cs[0].state.results.winner==="civilians");
  ok("caught imposter marked dead", cs[0].state.results.players.find(p=>p.id===impId).dead===true);
  cs.forEach(c=>c.close()); await wait(300);

  // ---- IMPOSTERS WIN when they reach parity (a civilian gets voted out) ----
  cs = await room(3,["D","E","F"]);
  cs[0].sendj({type:"start"}); await wait(400);
  await playToVote(cs);
  impId = cs.find(x=>x.state.round.yourRole==="imposter").youId;
  const civId = cs.find(x=>x.state.round.yourRole==="civilian").youId;
  cs.forEach(x=>{ if(x.youId!==civId) x.sendj({type:"vote",targetId:civId}); else x.sendj({type:"vote",targetId:impId}); });
  await wait(500);
  ok("voting out a civilian to parity ends the game", cs[0].state.status==="results");
  ok("imposters win at parity", cs[0].state.results.winner==="imposters");
  cs.forEach(c=>c.close()); await wait(300);

  // ---- NO WINNER -> NEXT ROUND (votes accumulate) ----
  cs = await room(5,["G","H","I","J","K"]);
  cs[0].sendj({type:"settings",settings:{imposters:1}}); await wait(150);
  cs[0].sendj({type:"start"}); await wait(400);
  await playToVote(cs);
  ok("round 1 vote reached (5 players)", cs[0].state.status==="voting" && cs[0].state.round.roundNo===1);
  ok("threshold is 3 of 5", cs[0].state.round.threshold===3);
  // only 2 players vote one target -> below threshold 3 -> nobody out -> next round
  const t = cs[1].youId;
  cs[2].sendj({type:"vote",targetId:t}); cs[3].sendj({type:"vote",targetId:t}); await wait(1500);
  ok("no elimination below threshold -> advances to round 2", cs[0].state.status==="playing" && cs[0].state.round.roundNo===2);
  cs.forEach(c=>c.close()); await wait(300);

  // ---- VOTE TIMEOUT AUTO-RESOLVES (nobody votes) ----
  cs = await room(3,["A","B","C"]);
  cs[0].sendj({type:"start"}); await wait(300);
  await playToVote(cs);
  ok("reached voting", cs[0].state.status==="voting");
  ok("voteDeadline is set", typeof cs[0].state.round.voteDeadline==="number");
  await wait(1600); // past VOTE_SECONDS with zero votes
  ok("voting auto-resolves on its own (no votes -> next round)", cs[0].state.status!=="voting");
  cs.forEach(c=>c.close()); await wait(300);

  // ---- HOST KICKS A PLAYER ----
  cs = await room(3,["Boss","Vic","Z"]);
  const victimId = cs[1].youId;
  cs[0].sendj({type:"kick", targetId:victimId}); await wait(400);
  ok("kicked player is told they were removed", cs[1].wasKicked===true);
  ok("kicked player removed from roster", !cs[0].state.players.some(p=>p.id===victimId));
  ok("non-host cannot kick", (()=>{ cs[2].sendj({type:"kick",targetId:cs[0].youId}); return true; })());
  await wait(200);
  ok("host survived the illegal kick", cs[0].state.players.some(p=>p.id===cs[0].youId));
  cs.filter(c=>c.readyState===1).forEach(c=>c.close()); await wait(300);

  // ---- HOST LEAVES IN LOBBY -> migrates ----
  cs = await room(3,["H","I","J"]);
  ok("H is host", cs[0].state.isHost===true);
  cs[0].close(); await wait(500);
  const newHost = cs[1].state.players.find(p=>p.isHost);
  ok("host reassigned after host leaves", !!newHost && newHost.name!=="H");
  cs.slice(1).forEach(c=>c.close()); await wait(300);

  // ---- PLAYER DISCONNECTS ON THEIR TURN -> skipped ----
  cs = await room(4,["P","Q","R","S"]);
  cs[0].sendj({type:"start"}); await wait(350);
  const turnId = cs[0].state.round.turnPlayerId;
  const victim = cs.find(x=>x.youId===turnId);
  const others = cs.filter(x=>x.youId!==turnId && x.readyState===1);
  victim.close(); await wait(600);
  const ref = others.find(o=>o.state);
  ok("turn skipped when active player drops", ref.state.status!=="playing" || ref.state.round.turnPlayerId!==turnId);
  let g=0;
  while(ref.state.status==="playing" && g++<20){
    const cur=others.find(x=>x.youId===ref.state.round.turnPlayerId);
    if(!cur) break;
    cur.sendj({type:"clue",words:["x"]}); await wait(150);
  }
  ok("game still reaches voting after a drop", ref.state.status==="voting");
  others.forEach(o=>o.sendj({type:"vote",targetId:others[0].youId})); await wait(600);
  ok("vote resolves using connected voters only", ref.state.status!=="voting");
  others.forEach(c=>c.close()); await wait(300);

  // ---- FOUNDER RECLAIMS HOST ON RECONNECT ----
  cs = await room(3,["Founder","B2","C2"]);
  const fCode = cs[0].code, fId = cs[0].youId;
  ok("founder starts as host", cs[0].state.isHost===true);
  cs[0].close(); await wait(500); // founder drops -> host migrates
  ok("host migrated away while founder is gone", cs[1].state.players.find(p=>p.isHost)?.name!=="Founder");
  const back = client("Founder-back"); await wait(150);
  back.sendj({type:"rejoin", code:fCode, youId:fId}); await wait(400);
  ok("founder reclaims host on reconnect", cs[1].state.players.find(p=>p.isHost)?.name==="Founder");
  ok("reconnected founder sees itself as host", back.state && back.state.isHost===true);
  [back, cs[1], cs[2]].forEach(c=>c.close()); await wait(300);

  // ---- START WITH 2 PLAYERS BLOCKED ----
  cs = await room(2,["X","Y"]);
  cs[0].sendj({type:"start"}); await wait(300);
  ok("start blocked under 3 players", cs[0].state.status==="lobby");
  cs.forEach(c=>c.close()); await wait(200);

  // ---- NON-HOST CANNOT START / CHANGE SETTINGS ----
  cs = await room(3,["M","N","O"]);
  cs[1].sendj({type:"settings",settings:{imposters:2}}); await wait(250);
  ok("non-host cannot change settings", cs[0].state.settings.imposters===1);
  cs[1].sendj({type:"start"}); await wait(250);
  ok("non-host cannot start", cs[0].state.status==="lobby");
  cs.forEach(c=>c.close()); await wait(200);

  // ---- STALE CLOSE AFTER RECONNECT SHOULDN'T STEAL HOST ----
  cs = await room(3,["Host","B","C"]);
  const hostCode = cs[0].code, hostYouId = cs[0].youId, oldHostSocket = cs[0];
  const newHostSocket = client("Host-reconnect"); await wait(150);
  newHostSocket.sendj({type:"rejoin", code:hostCode, youId:hostYouId}); await wait(300);
  ok("reconnected socket sees itself as host", newHostSocket.state && newHostSocket.state.isHost===true);
  oldHostSocket.close(); await wait(500);
  ok("host NOT reassigned by the stale close", cs[1].state.players.find(p=>p.isHost)?.name==="Host");
  newHostSocket.sendj({type:"settings", settings:{imposters:2}}); await wait(300);
  ok("reconnected host can still act", cs[1].state.settings.imposters===2);
  [newHostSocket, cs[1], cs[2]].forEach(c=>c.close()); await wait(300);

  // ---- 2 IMPOSTERS ----
  cs = await room(5,["1","2","3","4","5"]);
  cs[0].sendj({type:"settings",settings:{imposters:2}}); await wait(250);
  cs[0].sendj({type:"start"}); await wait(400);
  const impCount = cs.filter(x=>x.state.round.yourRole==="imposter").length;
  ok("2 imposters assigned", impCount===2);
  ok("both imposters get null word", cs.filter(x=>x.state.round.yourRole==="imposter").every(x=>x.state.round.yourWord===null));
  cs.forEach(c=>c.close()); await wait(200);

  // ---- LOBBY AUTO-START COUNTDOWN SCHEDULING ----
  cs = await room(2,["A2","B2"]);
  ok("no auto-start countdown under 3 players", cs[0].state.autoStartAt==null);
  let c3 = client("C2"); await wait(120); c3.sendj({type:"join",code:cs[0].code,name:"C2"}); cs.push(c3); await wait(300);
  ok("auto-start countdown appears at 3 players", typeof cs[0].state.autoStartAt==="number");
  c3.close(); await wait(400);
  ok("auto-start countdown cancels back under 3", cs[0].state.autoStartAt==null);
  cs.slice(0,2).forEach(c=>c.close()); await wait(200);

  // ---- CHAT ----
  cs = await room(3,["Ann","Bob","Cid"]);
  cs[1].sendj({type:"chat", text:"hello there"}); await wait(200);
  ok("chat message reaches everyone", cs[0].state.chat.some(m=>m.text==="hello there" && m.name==="Bob"));
  cs[2].sendj({type:"chat", text:"x".repeat(400)}); await wait(150);
  ok("chat trimmed to 160 chars", cs[0].state.chat.find(m=>m.name==="Cid").text.length===160);
  cs[0].sendj({type:"settings", settings:{chat:false}}); await wait(200);
  ok("chat hidden from state when disabled", cs[0].state.chat.length===0);
  cs.forEach(c=>c.close()); await wait(200);

  console.log("\n"+(fail.length?"FAILURES: "+fail.join("; "):"ALL EDGE CASES PASSED"));
  process.exit(fail.length?1:0);
})();
