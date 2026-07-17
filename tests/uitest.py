import subprocess, time, os, signal, re, pathlib
from playwright.sync_api import sync_playwright

env = dict(os.environ, PORT="8821", HOST="127.0.0.1")
srv = subprocess.Popen(["node","../server.js"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.2)

BASE = pathlib.Path("../online.html").resolve().as_uri()
results = []
def ok(label, cond):
    results.append((label, cond)); print(("PASS  " if cond else "FAIL  ")+label)

try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        ctxs, pages = [], []
        ws_frames = {}  # page -> list of raw websocket frame payloads it received
        for i in range(3):
            c = b.new_context(viewport={"width":390,"height":844}, device_scale_factor=2)
            pg = c.new_page()
            frames = []
            ws_frames[pg] = frames
            # capture every raw frame the socket receives — the strongest possible
            # check that the imposter's device never receives the secret word is to
            # inspect the actual network payloads, not just the parsed page HTML
            # (which also contains static JS/CSS source and can false-positive on
            # an unrelated word, e.g. a code comment coincidentally matching the
            # round's random secret word).
            pg.on("websocket", lambda ws, frames=frames: ws.on("framereceived", lambda payload, frames=frames: frames.append(payload)))
            pg.add_init_script("localStorage.setItem('nocap_server','ws://127.0.0.1:8821')")
            pg.goto(BASE); pg.wait_for_timeout(600)
            ctxs.append(c); pages.append(pg)

        host, p2, p3 = pages
        # HOST creates
        host.fill("#nameIn","Arjun"); host.click("#goBtn"); host.wait_for_timeout(1200)
        code = host.inner_text("#lobbyCode").strip()
        ok(f"host reached lobby, code={code}", re.fullmatch(r"[A-Z0-9]{4}", code) is not None)
        host.screenshot(path="ui_lobby_host.png")

        # joiners
        for pg, nm in [(p2,"Meera"), (p3,"Rahul")]:
            pg.fill("#nameIn", nm); pg.click("#mJoin"); pg.wait_for_timeout(200)
            pg.fill("#codeIn", code); pg.click("#goBtn"); pg.wait_for_timeout(900)
        host.wait_for_timeout(600)
        ok("all 3 in roster", host.locator(".rost").count() == 3)
        ok("guest sees waiting note", p2.locator("#guestNote").is_visible())
        ok("guest has no start button", not p2.locator("#startOnline").is_visible())
        p2.screenshot(path="ui_lobby_guest.png")

        # host starts the game
        host.click("#startOnline"); host.wait_for_timeout(1000)
        ok("all reached role screen", all(pg.locator("#s-role").get_attribute("class").find("active")>=0 for pg in pages))

        # flip all role cards
        roles = {}
        for pg, nm in zip(pages, ["Arjun","Meera","Rahul"]):
            pg.click("#roleCard"); pg.wait_for_timeout(700)
            txt = pg.inner_text("#roleFront")
            roles[nm] = "imposter" if "IMPOSTER" in txt else "civilian"
        ok("exactly one imposter shown", sum(1 for v in roles.values() if v=="imposter")==1)
        imp_name = [k for k,v in roles.items() if v=="imposter"][0]
        imp_page = pages[["Arjun","Meera","Rahul"].index(imp_name)]
        imp_page.screenshot(path="ui_role_imposter.png")
        civ_page = next(pg for pg,nm in zip(pages,["Arjun","Meera","Rahul"]) if nm!=imp_name)
        civ_page.screenshot(path="ui_role_civilian.png")

        # verify the imposter's device never received the word — check the actual
        # raw websocket frames, not the page HTML (which also contains static JS/CSS
        # source text unrelated to any round and can coincidentally match)
        word = None
        for pg,nm in zip(pages,["Arjun","Meera","Rahul"]):
            if roles[nm]=="civilian":
                word = pg.evaluate("() => S.state.round.yourWord"); break
        imp_word = imp_page.evaluate("() => S.state.round.yourWord")
        ok("imposter client has null word", imp_word is None)
        imp_frames_text = " ".join(str(f) for f in ws_frames[imp_page]).lower()
        ok(f"secret word '{word}' absent from imposter's received network frames",
           word.lower() not in imp_frames_text)

        # proceed to play
        for pg in pages: pg.click("#roleGo"); pg.wait_for_timeout(300)
        host.wait_for_timeout(400)
        ok("play screen active", "active" in host.locator("#s-play").get_attribute("class"))

        # round 1: 3 players give one clue each, one word per turn, then it's vote time
        guard = 0
        while guard < 10:
            status = host.evaluate("() => S.state.status")
            if status != "playing": break
            turn_id = host.evaluate("() => S.state.round.turnPlayerId")
            cur = next((pg for pg in pages if pg.evaluate("() => S.youId") == turn_id), None)
            if cur is None: break
            inputs = cur.locator("#clueInputs input")
            ok(f"exactly one clue input shown (turn {guard})", inputs.count() == 1)
            inputs.nth(0).fill(f"clue{guard}")
            if guard == 0: cur.screenshot(path="ui_myturn.png")
            cur.click("#sendClue"); cur.wait_for_timeout(600)
            guard += 1
        ok("3 clue turns in round 1 (one pass, then vote)", guard == 3)
        host.wait_for_timeout(600)
        ok("advanced to vote screen after the round", "active" in host.locator("#s-ovote").get_attribute("class"))
        ok("vote screen lists all 3 players", host.locator("#oVoteGrid .vrow").count()==3)
        ok("vote rule text shows (most-voted is out)", "most-voted" in host.inner_text("#voteSub").lower())
        ok("vote countdown timer showing", "to vote" in host.inner_text("#voteTimerTxt").lower())
        host.screenshot(path="ui_vote.png")

        # everyone votes the imposter out (imposter throws their vote on a civilian)
        imp_id = imp_page.evaluate("() => S.youId")
        civ_id = civ_page.evaluate("() => S.youId")
        for pg in pages:
            me = pg.evaluate("() => S.youId")
            target = civ_id if me == imp_id else imp_id
            btn = pg.locator(f'.v-btn[data-id="{target}"]')
            if btn.count() > 0: btn.click()
            pg.wait_for_timeout(250)
        host.wait_for_timeout(1000)
        ok("results screen reached (imposter caught)", "active" in host.locator("#s-oresults").get_attribute("class"))
        verdict = host.inner_text("#oVerdict").strip()
        ok(f"verdict = Civilians win! (got '{verdict}')", "civilian" in verdict.lower())
        ok("word revealed to all", word.lower() in host.inner_text("#oWord").lower())
        ok("imposter shown with Imposter tag in the reveal", "imposter" in host.inner_text("#oList").lower())
        host.screenshot(path="ui_results.png")

        # play again
        host.click("#oAgain"); host.wait_for_timeout(1000)
        ok("play-again returns everyone to role card", all("active" in pg.locator("#s-role").get_attribute("class") for pg in pages))

        b.close()
finally:
    srv.send_signal(signal.SIGTERM); srv.wait(timeout=5)

bad = [l for l,c in results if not c]
print("\n" + ("FAILURES: "+"; ".join(bad) if bad else "ALL UI CHECKS PASSED"))
