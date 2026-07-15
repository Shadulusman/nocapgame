process.env.PORT = "8811"; process.env.HOST = "127.0.0.1";
require("../server.js");
const WebSocket = require("ws");
const URL = "ws://127.0.0.1:8811";
const wait = ms => new Promise(r => setTimeout(r, ms));
const fail = [];
const ok = (l,c) => { console.log((c?"PASS  ":"FAIL  ")+l); if(!c) fail.push(l); };
function client(name){
  const ws = new WebSocket(URL); ws.nm = name;
  ws.on("message", raw => { const m = JSON.parse(raw);
    if(m.type==="joined"){ ws.youId=m.youId; ws.code=m.code; }
    if(m.type==="state") ws.state=m;
    if(m.type==="error") console.log("  ! "+name+": "+m.message);
  });
  ws.sendj = o => ws.send(JSON.stringify(o));
  return ws;
}
setTimeout(()=>{ console.log("TIMEOUT"); process.exit(1); }, 20000);
(async () => {
  await wait(400);
  const A=client("Arjun"); await wait(250);
  A.sendj({type:"create",name:"Arjun"}); await wait(300);
  const code=A.code;
  ok("room code 4 chars: "+code, /^[A-Z0-9]{4}$/.test(code));
  const B=client("Meera"), C=client("Rahul"); await wait(250);
  B.sendj({type:"join",code,name:"Meera"}); C.sendj({type:"join",code,name:"Rahul"}); await wait(400);
  ok("3 players in lobby", A.state.players.length===3);
  ok("host flag correct", A.state.isHost===true && B.state.isHost===false);
  const X=client("Ghost"); await wait(200);
  X.sendj({type:"join",code:"ZZZZ",name:"Ghost"}); await wait(250);
  A.sendj({type:"settings",settings:{wordsPerTurn:2,rounds:1,imposters:1}}); await wait(250);
  ok("settings sync to non-host", B.state.settings.wordsPerTurn===2);
  A.sendj({type:"start"}); await wait(400);
  const all=[A,B,C];
  ok("status=playing", A.state.status==="playing");
  const imps=all.filter(x=>x.state.round.yourRole==="imposter");
  const civs=all.filter(x=>x.state.round.yourRole==="civilian");
  ok("exactly 1 imposter", imps.length===1);
  ok("IMPOSTER WORD IS NULL (anti-cheat)", imps[0].state.round.yourWord===null);
  ok("civilians share one word", new Set(civs.map(x=>x.state.round.yourWord)).size===1);
  console.log("      word="+civs[0].state.round.yourWord+" hint="+JSON.stringify(imps[0].state.round.yourHint));
  const notTurn=all.find(x=>x.youId!==A.state.round.turnPlayerId);
  notTurn.sendj({type:"clue",words:["cheat"]}); await wait(250);
  ok("out-of-turn clue rejected", A.state.round.clues.length===0);
  let g=0;
  while(A.state.status==="playing" && g++<30){
    const cur=all.find(x=>x.youId===A.state.round.turnPlayerId);
    const n=A.state.round.wordsPerTurn;
    cur.sendj({type:"clue",words:Array.from({length:n},(_,i)=>cur.nm.toLowerCase()+"-w"+(i+1))});
    await wait(180);
  }
  ok("3 clues captured", A.state.round.clues.length===3);
  ok("2 words per turn", A.state.round.clues.every(c=>c.words.length===2));
  ok("feed live for all", B.state.round.clues.length===3 && C.state.round.clues.length===3);
  console.log("      feed: "+A.state.round.clues.map(c=>c.name+" → "+c.words.join(", ")).join("  |  "));
  ok("auto-advance to voting", A.state.status==="voting");
  all.forEach(x=>x.sendj({type:"vote",targetId:imps[0].youId})); await wait(450);
  ok("status=results", A.state.status==="results");
  const r=A.state.results;
  ok("voted-out is the imposter", r.votedOutId===imps[0].youId);
  ok("civilians win when caught", r.imposterWon===false);
  console.log("      out="+r.votedOutName+" word="+r.word+" ("+r.catName+")");
  console.log("      roles: "+r.players.map(p=>p.name+":"+p.role+"("+p.votes+"v)").join(", "));
  A.sendj({type:"again"}); await wait(400);
  ok("play-again restarts", A.state.status==="playing");
  ok("word still hidden on replay", all.filter(x=>x.state.round.yourRole==="imposter")[0].state.round.yourWord===null);
  console.log("\n"+(fail.length? "FAILURES: "+fail.join("; ") : "ALL CHECKS PASSED"));
  process.exit(fail.length?1:0);
})();
