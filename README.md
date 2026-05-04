# Integral Racing — Multiplayer

A networked version of the calculus card game. 2-4 players, web browsers, real-time.

## Run locally

```bash
npm install
npm start
# open http://localhost:3000 in 2-4 browser tabs/windows
```

## Deploy to Render (free)

1. Push this folder to a GitHub repo.
2. On render.com → New → Web Service → connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. You'll get a URL like `https://your-app.onrender.com` — share with friends.

(Free tier sleeps after 15 min of inactivity. First connection wakes it.)

## How to play

1. First player picks "Create room" with a code (e.g. `CALC1`).
2. Others pick "Join room" and enter the same code.
3. Once 2-4 are in the lobby, the host clicks Start.
4. Each turn: pick one card from your hand, target if needed, watch your equation evolve.
5. First to 2,500 miles wins.

## Files

- `server.js` — Express + Socket.io
- `game.js` — game rules and state (server-side)
- `public/index.html` — client UI (single file)
