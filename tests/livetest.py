import subprocess, time, os, signal, re
from playwright.sync_api import sync_playwright

env = dict(os.environ, PORT="8833", HOST="127.0.0.1")
srv = subprocess.Popen(["node","../server.js"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.3)

BASE = "http://127.0.0.1:8833"          # served BY the server, like Render
results=[]
def ok(l,c): results.append((l,c)); print(("PASS  " if c else "FAIL  ")+l)

try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        pages=[]
        for i in range(3):
            c=b.new_context(viewport={"width":390,"height":844})
            pg=c.new_page(); pages.append(pg)

        host,p2,p3 = pages
        # NO localStorage override — must auto-detect
        host.goto(BASE + "/online.html"); host.wait_for_timeout(900)
        detected = host.evaluate("() => SERVER_URL")
        ok(f"auto-detected server url = {detected}", detected == "ws://127.0.0.1:8833")
        ok("CSS applied (served over http)", host.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(15, 11, 22)")

        # root serves pass-and-play
        p2.goto(BASE + "/"); p2.wait_for_timeout(700)
        ok("/ serves pass-and-play app", "bhedi" in p2.inner_text(".wordmark").lower())
        # icons + manifest reachable
        r_icon = p2.evaluate("async()=>{const r=await fetch('/icons/icon-192.png');return r.status;}")
        r_man  = p2.evaluate("async()=>{const r=await fetch('/manifest.json');return r.status;}")
        r_sw   = p2.evaluate("async()=>{const r=await fetch('/sw.js');return r.status;}")
        ok("icons served (200)", r_icon==200)
        ok("manifest served (200)", r_man==200)
        ok("service worker served (200)", r_sw==200)
        r_404 = p2.evaluate("async()=>{const r=await fetch('/nope.txt');return r.status;}")
        ok("unknown path 404s", r_404==404)
        r_trav = p2.evaluate("async()=>{const r=await fetch('/../../etc/passwd');return r.status;}")
        ok(f"path traversal blocked (got {r_trav})", r_trav in (403,404))

        # full game over the single deploy
        for pg in [p2,p3]:
            pg.goto(BASE + "/online.html"); pg.wait_for_timeout(700)
        host.fill("#nameIn","Arjun"); host.click("#goBtn"); host.wait_for_timeout(1200)
        code = host.inner_text("#lobbyCode").strip()
        ok(f"room created, code={code}", re.fullmatch(r"[A-Z0-9]{4}", code) is not None)
        for pg,nm in [(p2,"Meera"),(p3,"Rahul")]:
            pg.fill("#nameIn",nm); pg.click("#mJoin"); pg.wait_for_timeout(200)
            pg.fill("#codeIn",code); pg.click("#goBtn"); pg.wait_for_timeout(900)
        host.wait_for_timeout(500)
        ok("3 players joined via one deploy", host.locator(".rost").count()==3)

        # public room browser: this lobby room should be listed while open
        rooms_open = p2.evaluate("async()=>{const r=await fetch('/rooms');return await r.json();}")
        ok("open room browser lists our lobby room", any(x["code"]==code for x in rooms_open))
        listed = next(x for x in rooms_open if x["code"]==code)
        ok("listed room shows correct player count", listed["players"]==3)

        host.click("#startOnline"); host.wait_for_timeout(900)
        rooms_after_start = p2.evaluate("async()=>{const r=await fetch('/rooms');return await r.json();}")
        ok("room drops off the browser once the game starts", not any(x["code"]==code for x in rooms_after_start))
        for pg in pages: pg.click("#roleCard"); pg.wait_for_timeout(600)
        imp = None
        for pg in pages:
            if pg.evaluate("()=>S.state.round.yourRole")=="imposter": imp=pg
        ok("imposter word hidden end-to-end", imp.evaluate("()=>S.state.round.yourWord") is None)
        for pg in pages: pg.click("#roleGo"); pg.wait_for_timeout(250)
        g=0
        while g<8 and host.evaluate("()=>S.state.status")=="playing":
            tid=host.evaluate("()=>S.state.round.turnPlayerId")
            cur=next(x for x in pages if x.evaluate("()=>S.youId")==tid)
            ins=cur.locator("#clueInputs input")
            for i in range(ins.count()): ins.nth(i).fill(f"w{g}{i}")
            cur.click("#sendClue"); cur.wait_for_timeout(600); g+=1
        ok("clues flowed, reached voting", host.evaluate("()=>S.state.status")=="voting")
        impid=imp.evaluate("()=>S.youId")
        for pg in pages: pg.locator(f'.vote-cell[data-id="{impid}"]').click(); pg.wait_for_timeout(300)
        host.wait_for_timeout(800)
        ok("results reached", host.evaluate("()=>S.state.status")=="results")
        host.screenshot(path="live_results.png")
        b.close()
finally:
    srv.send_signal(signal.SIGTERM); srv.wait(timeout=5)

bad=[l for l,c in results if not c]
print("\n"+("FAILURES: "+"; ".join(bad) if bad else "SINGLE-DEPLOY: ALL PASSED"))
