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
    if(m.type==="state") ws.state=m;});
  ws.sendj=o=>{ if(ws.readyState===1) ws.send(JSON.stringify(o)); };
  return ws;
}
async function room(n, names){
  const cs=[]; const A=client(names[0]); await wait(250);
  A.sendj({type:"create",name:names[0]}); await wait(300); cs.push(A);
  for(let i=1;i<n;i++){ const c=client(names[i]); await wait(120); c.sendj({type:"join",code:A.code,name:names[i]}); cs.push(c); }
  await wait(400); return cs;
}
setTimeout(()=>{console.log("TIMEOUT");process.exit(1);},40000);
(async()=>{
  await wait(400);

  // ---- TIE VOTE ----
  let cs = await room(4,["A","B","C","D"]);
  cs[0].sendj({type:"settings",settings:{rounds:1,imposters:1}}); await wait(200);
  cs[0].sendj({type:"start"}); await wait(300);
  let g=0;
  while(cs[0].state.status==="playing" && g++<20){
    const cur=cs.find(x=>x.youId===cs[0].state.round.turnPlayerId);
    cur.sendj({type:"clue",words:["w"]}); await wait(150);
  }
  // 2 vs 2 tie
  cs[0].sendj({type:"vote",targetId:cs[1].youId});
  cs[1].sendj({type:"vote",targetId:cs[0].youId});
  cs[2].sendj({type:"vote",targetId:cs[1].youId});
  cs[3].sendj({type:"vote",targetId:cs[0].youId});
  await wait(500);
  ok("tie -> results reached", cs[0].state.status==="results");
  ok("tie -> nobody voted out", cs[0].state.results.votedOutId===null);
  ok("tie -> imposter survives", cs[0].state.results.imposterWon===true);
  cs.forEach(c=>c.close()); await wait(300);

  // ---- VOTE TIMEOUT AUTO-RESOLVES (VOTE_SECONDS=1 for this test run) ----
  cs = await room(3,["A","B","C"]);
  cs[0].sendj({type:"settings",settings:{rounds:1}}); await wait(200);
  cs[0].sendj({type:"start"}); await wait(300);
  g=0;
  while(cs[0].state.status==="playing" && g++<20){
    const cur=cs.find(x=>x.youId===cs[0].state.round.turnPlayerId);
    cur.sendj({type:"clue",words:["w"]}); await wait(150);
  }
  ok("reached voting", cs[0].state.status==="voting");
  ok("voteDeadline is set", typeof cs[0].state.round.voteDeadline==="number");
  // nobody votes — timeout should resolve it on its own
  await wait(1600);
  ok("voting auto-resolved without any votes", cs[0].state.status==="results");
  cs.forEach(c=>c.close()); await wait(300);

  // ---- HOST LEAVES IN LOBBY ----
  cs = await room(3,["H","I","J"]);
  ok("H is host", cs[0].state.isHost===true);
  cs[0].close(); await wait(500);
  const newHost = cs[1].state.players.find(p=>p.isHost);
  ok("host reassigned after host leaves", !!newHost && newHost.name!=="H");
  ok("new host sees isHost", cs[1].state.isHost===true || cs[2].state.isHost===true);
  cs.slice(1).forEach(c=>c.close()); await wait(300);

  // ---- PLAYER DISCONNECTS ON THEIR TURN ----
  cs = await room(4,["P","Q","R","S"]);
  cs[0].sendj({type:"settings",settings:{rounds:1}}); await wait(200);
  cs[0].sendj({type:"start"}); await wait(350);
  const turnId = cs[0].state.round.turnPlayerId;
  const victim = cs.find(x=>x.youId===turnId);
  const others = cs.filter(x=>x.youId!==turnId && x.readyState===1);
  victim.close(); await wait(600);
  const ref = others.find(o=>o.state);
  ok("turn skipped when active player drops", ref.state.status!=="playing" || ref.state.round.turnPlayerId!==turnId);
  // finish remaining
  g=0;
  while(ref.state.status==="playing" && g++<20){
    const cur=others.find(x=>x.youId===ref.state.round.turnPlayerId);
    if(!cur) break;
    cur.sendj({type:"clue",words:["x"]}); await wait(150);
  }
  ok("game still reaches voting after drop", ref.state.status==="voting");
  // remaining 3 vote -> should tally with 3 voters not 4
  others.forEach(o=>o.sendj({type:"vote",targetId:others[0].youId})); await wait(500);
  ok("tally uses connected voters only", ref.state.status==="results");
  others.forEach(c=>c.close()); await wait(300);

  // ---- START WITH 2 PLAYERS BLOCKED ----
  cs = await room(2,["X","Y"]);
  cs[0].sendj({type:"start"}); await wait(300);
  ok("start blocked under 3 players", cs[0].state.status==="lobby");
  cs.forEach(c=>c.close()); await wait(200);

  // ---- NON-HOST CANNOT START / CHANGE SETTINGS ----
  cs = await room(3,["M","N","O"]);
  cs[1].sendj({type:"settings",settings:{rounds:3}}); await wait(250);
  ok("non-host cannot change settings", cs[0].state.settings.rounds===2);
  cs[1].sendj({type:"start"}); await wait(250);
  ok("non-host cannot start", cs[0].state.status==="lobby");
  cs.forEach(c=>c.close()); await wait(200);

  // ---- STALE CLOSE AFTER RECONNECT SHOULDN'T STEAL HOST OR SKIP BROADCASTS ----
  cs = await room(3,["Host","B","C"]);
  ok("Host is host initially", cs[0].state.isHost===true);
  const hostCode = cs[0].code, hostYouId = cs[0].youId, oldHostSocket = cs[0];
  const newHostSocket = client("Host-reconnect");
  await wait(150);
  newHostSocket.sendj({type:"rejoin", code:hostCode, youId:hostYouId});
  await wait(300); // let rejoin land: p.ws swaps to the new socket, connected=true
  ok("reconnected socket sees itself as host", newHostSocket.state && newHostSocket.state.isHost===true);
  oldHostSocket.close(); // the stale old connection's close event fires AFTER the reconnect
  await wait(500);
  ok("host NOT reassigned by the stale close", cs[1].state.players.find(p=>p.isHost)?.name==="Host");
  newHostSocket.sendj({type:"settings", settings:{rounds:3}});
  await wait(300);
  ok("reconnected host can still act (not silently marked disconnected)", cs[1].state.settings.rounds===3);
  [newHostSocket, cs[1], cs[2]].forEach(c=>c.close()); await wait(300);

  // ---- 2 IMPOSTERS ----
  cs = await room(5,["1","2","3","4","5"]);
  cs[0].sendj({type:"settings",settings:{imposters:2,rounds:1}}); await wait(250);
  cs[0].sendj({type:"start"}); await wait(400);
  const impCount = cs.filter(x=>x.state.round.yourRole==="imposter").length;
  ok("2 imposters assigned", impCount===2);
  ok("both imposters get null word", cs.filter(x=>x.state.round.yourRole==="imposter").every(x=>x.state.round.yourWord===null));
  cs.forEach(c=>c.close()); await wait(200);

  // ---- LOBBY AUTO-START COUNTDOWN SCHEDULING (timer fires in autostart.js) ----
  cs = await room(2,["A2","B2"]);
  ok("no auto-start countdown under 3 players", cs[0].state.autoStartAt==null);
  let c3 = client("C2"); await wait(120); c3.sendj({type:"join",code:cs[0].code,name:"C2"}); cs.push(c3);
  await wait(300);
  ok("auto-start countdown appears at 3 players", typeof cs[0].state.autoStartAt==="number");
  c3.close(); await wait(400);
  ok("auto-start countdown cancels back under 3", cs[0].state.autoStartAt==null);
  cs.slice(0,2).forEach(c=>c.close()); await wait(200);

  // ---- CHAT ----
  cs = await room(3,["Ann","Bob","Cid"]);
  cs[1].sendj({type:"chat", text:"hello there"}); await wait(200);
  ok("chat message reaches everyone", cs[0].state.chat.some(m=>m.text==="hello there" && m.name==="Bob"));
  cs[1].sendj({type:"chat", text:"   "}); await wait(150);
  ok("empty chat ignored", cs[0].state.chat.filter(m=>m.name==="Bob").length===1);
  const longText = "x".repeat(400);
  cs[2].sendj({type:"chat", text:longText}); await wait(150);
  ok("chat trimmed to 160 chars", cs[0].state.chat.find(m=>m.name==="Cid").text.length===160);
  cs[0].sendj({type:"settings", settings:{chat:false}}); await wait(200);
  ok("chat setting toggles off", cs[0].state.settings.chat===false);
  ok("chat hidden from state when disabled", cs[0].state.chat.length===0);
  cs[1].sendj({type:"chat", text:"should be blocked"}); await wait(200);
  cs[0].sendj({type:"settings", settings:{chat:true}}); await wait(200);
  ok("messages sent while disabled are dropped", !cs[0].state.chat.some(m=>m.text==="should be blocked"));
  cs.forEach(c=>c.close()); await wait(200);

  console.log("\n"+(fail.length?"FAILURES: "+fail.join("; "):"ALL EDGE CASES PASSED"));
  process.exit(fail.length?1:0);
})();
