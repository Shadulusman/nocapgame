process.env.PORT = "8812"; process.env.HOST = "127.0.0.1";
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
setTimeout(()=>{console.log("TIMEOUT");process.exit(1);},25000);
(async()=>{
  await wait(400);

  // ---- TIE VOTE ----
  let cs = await room(4,["A","B","C","D"]);
  cs[0].sendj({type:"settings",settings:{rounds:1,wordsPerTurn:1,imposters:1}}); await wait(200);
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
  cs[0].sendj({type:"settings",settings:{rounds:1,wordsPerTurn:1}}); await wait(200);
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
  cs[1].sendj({type:"settings",settings:{wordsPerTurn:3}}); await wait(250);
  ok("non-host cannot change settings", cs[0].state.settings.wordsPerTurn===2);
  cs[1].sendj({type:"start"}); await wait(250);
  ok("non-host cannot start", cs[0].state.status==="lobby");
  cs.forEach(c=>c.close()); await wait(200);

  // ---- 2 IMPOSTERS ----
  cs = await room(5,["1","2","3","4","5"]);
  cs[0].sendj({type:"settings",settings:{imposters:2,rounds:1,wordsPerTurn:1}}); await wait(250);
  cs[0].sendj({type:"start"}); await wait(400);
  const impCount = cs.filter(x=>x.state.round.yourRole==="imposter").length;
  ok("2 imposters assigned", impCount===2);
  ok("both imposters get null word", cs.filter(x=>x.state.round.yourRole==="imposter").every(x=>x.state.round.yourWord===null));
  cs.forEach(c=>c.close()); await wait(200);

  console.log("\n"+(fail.length?"FAILURES: "+fail.join("; "):"ALL EDGE CASES PASSED"));
  process.exit(fail.length?1:0);
})();
