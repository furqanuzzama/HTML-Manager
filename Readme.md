# GOAL_ENGINE_V3 — Backend

Express + MongoDB backend for the GOAL_ENGINE_V3 single-page app.

## File structure

```
goal-engine-backend/
├── server.js          ← entire backend (Express + Mongoose schemas + REST API)
├── public/
│   └── index.html     ← the frontend (served statically by Express)
├── .env.example      ← copy this to .env and fill in your MongoDB URI
├── package.json
└── README.md
```

## Quick start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment
```bash
cp .env.example .env
```
Then open `.env` and set your `MONGO_URI`. You can get a free cluster from [MongoDB Atlas](https://cloud.mongodb.com).

**MongoDB Atlas URI format:**
```
mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/goal_engine?retryWrites=true&w=majority
```

**Local MongoDB URI format:**
```
mongodb://localhost:27017/goal_engine
```

### 3. Run
```bash
node server.js
```

Open **http://localhost:3000** in your browser.

---

## How it works

### Data storage strategy

The frontend keeps the full state in memory (same as before). Every time you make a change (add a goal, complete a task, etc.), it calls `POST /api/state/sync` after a 600ms debounce — exactly how `localStorage.setItem` worked before.

On page load, `GET /api/state` hydrates the app from MongoDB instead of `localStorage.getItem`.

### API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | DB connection status |
| `GET` | `/api/state` | Load full state (used on page load) |
| `POST` | `/api/state/sync` | Save full state (debounced on every change) |
| `GET/POST/PATCH/DELETE` | `/api/goals/:id` | Granular goal CRUD |
| `GET/POST/PATCH/DELETE` | `/api/skills/:id` | Granular skill CRUD |
| `GET/POST/PATCH/DELETE` | `/api/books/:id` | Granular book CRUD |
| `GET/POST/PATCH/DELETE` | `/api/langs/:id` | Granular language CRUD |
| `GET/POST/DELETE` | `/api/friends/:id` | Friend CRUD |
| `GET/POST/PATCH/DELETE` | `/api/clients/:id` | Client CRUD |
| `GET/PATCH` | `/api/settings` | Social counts + ultimate goal |

### DB indicator

A small badge in the top nav shows:
- **DB ✓** (green) — connected and loaded successfully
- **DB ✗** (red) — MongoDB unreachable (app still works with defaults)

---

## Deployment

### Render / Railway / Fly.io
1. Push this folder to a GitHub repo
2. Create a new Web Service pointing to it
3. Set `MONGO_URI` and `PORT` as environment variables
4. Start command: `node server.js`

### Self-hosted VPS
```bash
npm install -g pm2
pm2 start server.js --name goal-engine
pm2 save
```

---

## MongoDB Atlas — free tier setup

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com) → Create free account
2. Create a free **M0 Shared** cluster
3. Database Access → Add database user (username + password)
4. Network Access → Allow access from anywhere (`0.0.0.0/0`) or your IP
5. Connect → Connect your application → Copy the connection string
6. Replace `<password>` in the string and paste it into your `.env`