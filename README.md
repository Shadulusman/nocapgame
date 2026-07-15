# Bhedi — how to put it live

You need **one** deploy. The server hosts the game *and* the website, and the app
figures out its own address. There is no URL to edit and nothing to configure.

Total time: about 15 minutes. No coding.

---

## What you're doing

Your files need to live on a computer that's always on. That's what Render is.
You'll put your files on GitHub (a file locker), then point Render at them.

---

## Step 1 — Put the files on GitHub (5 min)

1. Go to **github.com** -> **Sign up** (free).
2. Once logged in, click the **+** (top right) -> **New repository**.
3. Name it `bhedi`. Leave it **Public**. Click **Create repository**.
4. On the next page, click the link **"uploading an existing file"**.
5. Drag in **all of these**:
   - `index.html`
   - `online.html`
   - `server.js`
   - `package.json`
   - `manifest.json`
   - `sw.js`
   - the whole **`icons`** folder
6. Click **Commit changes** (green button, bottom).

> Do this on a laptop if you can - dragging a folder in is painful on a phone.

---

## Step 2 — Put it live on Render (5 min)

1. Go to **render.com** -> **Get Started** -> **Sign in with GitHub**.
2. Click **New +** -> **Web Service**.
3. Find your `bhedi` repo -> **Connect**.
4. Fill in:
   - **Language / Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** `Free`
5. Click **Create Web Service**. Wait ~2 minutes for it to build.
6. At the top you'll get your address, like `https://bhedi.onrender.com`.

**That's it. You're live.**

- Pass-and-play: `https://bhedi.onrender.com`
- Online multiplayer: `https://bhedi.onrender.com/online.html`

Don't touch the PORT setting - Render handles it.

---

## Step 3 — Try it

1. Open the online link on your phone.
2. Type your name -> **Make a room** -> you get a 4-letter code.
3. Open the same link on another phone, tap **Join a room**, type the code.
4. Get a third person in (minimum 3 players), then **Start game**.

**Install it like a real app:** open the link in Safari -> Share button ->
**Add to Home Screen**.

---

## The one thing that will confuse you

**The free Render tier falls asleep after ~15 minutes of nobody using it.**

The next person to open it waits **30-50 seconds** while it wakes up. It looks
broken. It isn't - it's just slow the first time.

If you're showing this to friends, open the link yourself a minute early so it's
awake. If real people start using it, upgrade to Render's paid instance (~$7/mo,
about Rs 600) and it never sleeps.

---

## If something goes wrong

**"Can't reach the server"** -> Render is probably asleep. Wait a minute and retry.
Still stuck? On Render, open your service -> **Logs**, and look for red errors.

**Page looks like plain text with giant icons** -> the HTML files got separated
from each other. Make sure all files are in the *same folder* in your repo, not
inside subfolders (except `icons`).

**"No room with that code"** -> codes are 4 letters, and rooms disappear when
everyone leaves. Make a new one.

**Nothing happens when you press Start** -> you need at least 3 players in the room.

---

## Making changes later

Edit a file on GitHub (click the file -> pencil icon -> **Commit changes**).
Render redeploys automatically in ~2 minutes. Your address stays the same.

To add or change words, open `server.js` on GitHub and edit the `CATEGORIES`
list near the top. The server holds the words - that's deliberate, so nobody can
peek at the answer by opening their browser's dev tools.

---

## What's in each file

| File | What it does |
|---|---|
| `index.html` | Pass-and-play game. Self-contained, works offline. |
| `online.html` | Online multiplayer. Self-contained. |
| `server.js` | Runs the rooms, keeps the secret word, serves the site. |
| `package.json` | Tells Render what to install. |
| `manifest.json`, `sw.js`, `icons/` | Makes it installable as an app. |

---

## How the game plays

1. Host makes a room, shares the 4-letter code.
2. Everyone taps their card. Civilians see the secret word; the bhedi doesn't.
3. Players take turns typing clue words. Everyone sees them appear live.
4. After the set number of turns, everyone votes.
5. Group wins by voting out the bhedi. **A tie means nobody goes out - the bhedi survives.**

Host settings: words per turn (1-3), turns each (1-3), imposters (1-2, needs 5+
players for two), whether the imposter sees the category, whether they get decoy
word hints, and which of the 15 category packs are in play.

---

## Known gaps

- No score tracking across rounds - each round stands alone.
- No profanity filter on typed clues or names.
- No rate limiting - someone could spam new rooms. Worth adding before you promote it widely.
- Rooms live in memory: if Render restarts, active games drop. Fine at this size.
- Custom word packs aren't editable in the app - only in `server.js`.
