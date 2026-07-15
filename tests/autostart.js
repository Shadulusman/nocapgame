// Isolated: verify a public lobby with 3+ players auto-starts on its own.
// Runs with LOBBY_SECONDS=2 so we don't wait the real 60s. Kept separate from
// edge.js because a short lobby timer would auto-start rooms in tests that
// deliberately sit in the lobby.
process.env.PORT = "8814"; process.env.HOST = "127.0.0.1"; process.env.LOBBY_SECONDS = "2";
require("../server.js");
const WebSocket = require("ws");
const URL = "ws://127.0.0.1:8814";
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
setTimeout(()=>{console.log("TIMEOUT");process.exit(1);},15000);
(async()=>{
  await wait(400);
  const A=client("A"); await wait(200); A.sendj({type:"create",name:"A"}); await wait(250);
  const cs=[A];
  for(const nm of ["B","C"]){ const c=client(nm); await wait(120); c.sendj({type:"join",code:A.code,name:nm}); cs.push(c); }
  await wait(300);
  ok("countdown scheduled at 3 players", typeof A.state.autoStartAt==="number");
  ok("still in lobby right after reaching 3", A.state.status==="lobby");
  // nobody presses start — wait past LOBBY_SECONDS
  await wait(2600);
  ok("auto-started without host pressing start", A.state.status==="playing");
  ok("every player got a role on auto-start", cs.every(c=>c.state.round && c.state.round.yourRole));
  cs.forEach(c=>c.close()); await wait(200);
  console.log("\n"+(fail.length?"FAILURES: "+fail.join("; "):"AUTO-START: ALL PASSED"));
  process.exit(fail.length?1:0);
})();
