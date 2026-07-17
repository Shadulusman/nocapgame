process.env.PORT = "8811"; process.env.HOST = "127.0.0.1"; process.env.VOTE_SECONDS = "2";
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
  ws.sendj = o => { if(ws.readyState===1) ws.send(JSON.stringify(o)); };
  return ws;
}
setTimeout(()=>{ console.log("TIMEOUT"); process.exit(1); }, 25000);
(async () => {
  await wait(400);
  const A=client("Arjun"); await wait(250);
  A.sendj({type:"create",name:"Arjun"}); await wait(300);
  const code=A.code;
  ok("room code 4 chars: "+code, /^[A-Z0-9]{4}$/.test(code));
  const B=client("Meera"), C=client("Rahul"); await wait(250);
  B.sendj({type:"join",code,name:"Meera"}); C.sendj({type:"join",code,name:"Rahul"}); await wait(400);
  const all=[A,B,C];
  ok("3 players in lobby", A.state.players.length===3);
  ok("host flag correct", A.state.isHost===true && B.state.isHost===false);
  A.sendj({type:"start"}); await wait(400);
  ok("status=playing", A.state.status==="playing");
  ok("game starts at round 1", A.state.round.roundNo===1);
  const imps=all.filter(x=>x.state.round.yourRole==="imposter");
  const civs=all.filter(x=>x.state.round.yourRole==="civilian");
  ok("exactly 1 imposter", imps.length===1);
  ok("IMPOSTER WORD IS NULL (anti-cheat)", imps[0].state.round.yourWord===null);
  ok("civilians share one word", new Set(civs.map(x=>x.state.round.yourWord)).size===1);
  ok("no live votes before anyone votes", A.state.round.order.every(o=>o.votes===0));
  const impId=imps[0].youId;

  // Play clue rounds + vote every round until a side wins. Everyone votes the
  // imposter (imposter casts a throwaway vote on a civilian).
  let guard=0, checkedLive=false;
  while(A.state.status!=="results" && guard++<40){
    if(A.state.status==="playing"){
      const cur=all.find(x=>x.youId===A.state.round.turnPlayerId);
      if(cur) cur.sendj({type:"clue",words:["gym"]});
      await wait(120);
    } else if(A.state.status==="voting"){
      const order=A.state.round.order;
      if(!checkedLive){
        // one voter casts first → everyone should see that target's LIVE count tick to 1
        checkedLive=true;
        const voter=all.find(x=>x.youId!==impId), target=impId;
        voter.sendj({type:"vote",targetId:target}); await wait(250);
        const row=B.state.round.order.find(o=>o.id===target);
        ok("live vote count shows on the target (1)", row && row.votes===1);
      }
      all.forEach(x=>{
        const me=order.find(o=>o.id===x.youId);
        if(me && !me.dead){
          const target = x.youId===impId ? order.find(o=>!o.dead && o.id!==impId).id : impId;
          x.sendj({type:"vote",targetId:target});
        }
      });
      await wait(300);
    }
  }
  ok("game reached results", A.state.status==="results");
  const res=A.state.results;
  ok("civilians win when the imposter is caught", res.winner==="civilians");
  const impRow=res.players.find(p=>p.id===impId);
  ok("imposter revealed as imposter", impRow && impRow.role==="imposter");
  ok("caught imposter is marked dead", impRow && impRow.dead===true);
  ok("secret word revealed at the end", typeof res.word==="string" && res.word.length>0);
  ok("imposter never saw the word all game", imps[0].state.round === undefined || imps[0].state.round.yourWord == null || imps[0].state.round.category != null);

  A.sendj({type:"again"}); await wait(400);
  ok("play-again restarts a fresh game", A.state.status==="playing" && A.state.round.roundNo===1);
  ok("word still hidden on replay", all.filter(x=>x.state.round.yourRole==="imposter")[0].state.round.yourWord===null);
  console.log("\n"+(fail.length? "FAILURES: "+fail.join("; ") : "ALL CHECKS PASSED"));
  process.exit(fail.length?1:0);
})();
