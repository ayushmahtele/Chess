# Chess Throne

*Rise To The Throne*

A complete chess website built on my own chess engine (originally `engine.py`, ported to JavaScript).

**Play:** against the computer (400–2000 strength), two players on one device, or **online** by username, invite link or quick match · time controls from bullet to rapid · rated and casual games
**Board:** flat (2D) or **3D** view · 9 flat piece styles and 7 rendered 3D piece materials · 5 flat boards and 8 3D boards · drag-and-drop or click · legal-move dots · promotion picker · right-click arrows and square marks · light/dark theme
**Works on every screen:** board and moves always visible together on laptops; tablets and phones get a full-width board, a swipeable move strip and a fixed button bar
**During a game:** takebacks, hints and an evaluation bar (casual games) · offer draw · resign · abort · checkmate, stalemate, repetition, 50-move rule, insufficient material, timeout
**Sign-in page:** an interactive 3D board replaying the finish of *The Immortal Game* (Anderssen vs Kieseritzky, 1851) — drag to rotate, scroll or pinch to zoom
**Accounts:** Google or username + password sign-in, linkable to each other (or guest mode) · choose Beginner / Intermediate / Pro to set your starting rating · Glicko-2 rating like chess.com (new accounts move fast, then settle) · rating graph, peak, win rate
**History:** every finished or aborted game is saved · replay move by move · engine "best move" · copy/download PGN · delete one game or all
**Sound:** realistic wooden-board move sounds (or classic clicks) · 4 original background tracks · add your own songs from your device · separate music and effects volume, shuffle and repeat
**Unfinished games** are restored after a refresh.

---

## 1. Run it on your computer

Install [Node.js](https://nodejs.org) 20 or newer, then in this folder:

```bash
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173). Without Firebase keys it runs in guest mode, which saves everything in the browser.

## 2. Put the code on GitHub

Create a new repository on GitHub and push this folder to it (GitHub Desktop is the easiest way if you're new to git). `node_modules`, `dist` and `.env.local` are ignored automatically.

## 3. Set up accounts and the online database (Firebase, free)

1. Go to https://console.firebase.google.com and click **Add project**. Any name works (Google Analytics can be turned off).
2. **Build → Authentication → Get started → Sign-in method**, then enable:
   - **Google** (pick your email as the support email), and
   - **Email/Password** (only the first switch). This powers *username + password* sign-in; players never see an email.
3. **Build → Firestore Database → Create database**, choose **production mode** and a location near your players (for India: `asia-south1 (Mumbai)`).
4. In Firestore open the **Rules** tab, delete what's there, paste everything from `firestore.rules`, and click **Publish**. These rules keep each player's data private and let only the two players change an online game.
5. **Project settings** (gear icon) → **General** → **Your apps** → click the **`</>`** (Web) icon → register the app. Copy the values from the `firebaseConfig` it shows.
6. In the project folder, copy `.env.example` to a new file named `.env.local` and paste the six values. Stop `npm run dev` (Ctrl + C) and start it again.
7. Open http://localhost:5173 — you should now see **Sign in** at the top right. `localhost` works for Google sign-in automatically.

Test online play on your own computer by opening a second browser (or an Incognito window), signing in as a different player, and challenging yourself by username.

## 4. Publish the website (Vercel, free)

1. Put the code on GitHub (step 2).
2. Sign in at https://vercel.com with GitHub → **Add New → Project** → import your repository. Vercel detects Vite automatically.
3. Open **Environment Variables** and add the same six `VITE_FIREBASE_...` names and values as in your `.env.local`.
4. Click **Deploy**. You get an address like `chess-arena-ayush.vercel.app`.
5. Back in Firebase: **Authentication → Settings → Authorized domains → Add domain** and add that Vercel address (without `https://`). Google sign-in only works on domains listed here.

From then on, every time you push changes to GitHub, Vercel updates the live site in about a minute. If you change environment variables, click **Redeploy**.

### Your own .com domain

Buy a domain from any registrar (Namecheap, GoDaddy, Hostinger, Cloudflare, etc.). In Vercel open **Project → Settings → Domains**, add it, and create the DNS records Vercel shows you at your registrar (it can take up to a few hours to work). Then add the domain (and `www.` version) to Firebase's **Authorized domains**.

### Using Render instead

On https://render.com create a **Static Site** from your GitHub repo with build command `npm install && npm run build` and publish directory `dist`, and add the same environment variables (or use the included `render.yaml`). Add the `.onrender.com` address (and any custom domain) to Firebase's authorized domains.

## Accounts and online play

- **Sign in** with Google or with a **username + password**. Usernames are unique and can't be changed.
- **Link both** in **Profile → Sign-in methods**: a username account can link Google, and a Google account can add a password, so you can sign in either way and keep the same rating and games.
- The first time you sign in, you can **bring your guest progress** (rating and games from this browser) into the account.
- **Online tab:** quick match with anyone using the same settings, **challenge a friend by username** (they get a pop-up on any page), or **send an invite link**.
- During a game: clocks with increments, chat, draw offers, resign, abort (before both players have moved), rematch. If someone doesn't make their first move within a minute the game is aborted; if a player closes the game for more than a minute, the other can claim the win.
- Online games have their **own rating** (Glicko-2, separate from the computer rating) and are saved in both players' History with full review.

### Limits of the free plan

Firebase's free plan allows about 50,000 database reads and 20,000 writes per day, which is plenty for you and your friends (a 10-minute game uses roughly 100 writes). If the site gets popular, Firebase will warn you before anything stops working.

### Fair play

Moves are checked in the browser and protected by the database rules, which is fine for friends. A determined programmer could still send fake moves or edit their own rating. For a public competitive site, move validation and rating updates should move to the server with Firebase Cloud Functions (paid Blaze plan, still cheap at small scale).

## Password reset by email code (one-time setup)

"Forgot your password?" emails a 6-digit code to the Gmail linked to the account. This runs as two small
server functions in the `api/` folder, which Vercel runs for free. They need three extra environment variables
in **Vercel → Project → Settings → Environment Variables** (Production and Preview):

| Name | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Firebase console → ⚙ Project settings → **Service accounts** → **Generate new private key**. Open the downloaded `.json` file in Notepad, copy **all** of it and paste it as the value. Keep this file secret and never commit it. |
| `GMAIL_USER` | The Gmail address the codes are sent **from**, e.g. `yourname@gmail.com` |
| `GMAIL_APP_PASSWORD` | A 16-letter **app password** for that Gmail: Google Account → Security → turn on **2-Step Verification** → search **App passwords** → create one named "Chess Throne". |

Then **Redeploy** (Deployments → ⋯ → Redeploy). Until these are set, "Forgot your password?" explains that email
reset isn't set up yet, and players can still recover by signing in with Google.

Safety: codes expire after 10 minutes, at most one code per minute and 5 per hour, 5 wrong tries locks the code,
and a successful reset signs the account out on other devices. Gmail allows about 500 emails a day.

## How the rating works

New accounts pick a level: Beginner 800, Intermediate 1200 or Pro 1600. Ratings use Glicko-2, the same family of system chess.com uses. Each account has a *rating deviation*: it starts high, so early results move your rating a lot (a new Pro who loses to a 1200 bot drops around 270 points), and it shrinks as you play, so later changes are smaller. A `?` after a rating means it is still provisional. Only rated games against the computer change your rating; aborted games never do.

Ratings are calculated in the browser, so a determined player could edit their own number. That's fine for playing against a computer, but if you ever add online play between people, rating updates should move to a server (for example Firebase Cloud Functions).

## Project layout

```
src/engine/engine.js     the chess engine (port of engine.py): minimax, alpha-beta, quiescence, transposition table, opening book
src/engine/worker.js     runs the engine in the background so the page never freezes
src/game.js              game rules (chess.js), clocks, draws, saving games, rating updates
src/board.js             the interactive board
src/rating.js            Glicko-2
src/store/               guest storage, sign-in (Firebase Auth) and the database wrapper
src/three/immortal.js    the 3D board on the sign-in page (three.js)
src/online.js            online games: create/join, moves, clocks, draws, rematch, saving and online rating
src/audio/               sound effects and the music player
src/views/               pages: home, game, history, review, profile, settings, welcome
src/config.js            site name, time controls, computer levels
public/pieces/           piece images
```

To rename the site, change `APP_NAME` in `src/config.js` and the `<title>` in `index.html`.

## Piece sets, boards and credits

See `CREDITS.md` for the authors and licenses of every piece set and board image. Keep that file (and the credits on the Settings page) when you publish the site.

## Music

The built-in tracks are original and generated live in the browser. Players can add songs they own with **Add songs**; the files stay on their own device (IndexedDB) and are never uploaded. Don't bundle commercial songs into the site itself, since hosting them publicly needs a licence from the rights holders.
