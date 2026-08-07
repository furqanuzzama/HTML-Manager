/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║             GOAL_ENGINE_V3 — BACKEND SERVER (v4)             ║
 * ║   Express + MongoDB single-file backend                     ║
 * ║   Serves the HTML frontend + REST API at /api/*             ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * SETUP:
 *   1.  npm install
 *   2.  cp .env.example .env  →  fill in MONGO_URI (and optionally PORT)
 *   3.  node server.js
 *
 * ENV VARS (.env):
 *   MONGO_URI   = mongodb+srv://<user>:<pass>@cluster.mongodb.net/goal_engine
 *   PORT        = 3000  (optional, default 3000)
 *
 * WHY THIS VERSION LOOKS DIFFERENT FROM v3:
 *   The frontend was rebuilt around three pages — PERSONAL / SOCIAL /
 *   PROFESSIONAL — with a totally different `state` shape:
 *
 *     state = {
 *       personal: {
 *         board1:   { bad: [], good: [], best: [] },        // Life Quality kanban
 *         board2:   { todo: [], inprogress: [], done: [] }, // Tasks kanban
 *         pinboard: [ { id, text } ],
 *       },
 *       social: {
 *         instagram: { followers, posts, handle },
 *         youtube:   { subscribers, videos, handle },
 *         linkedin:  { connections, posts, handle },
 *       },
 *       professional: {
 *         toWorkOn: [ { id, text } ],
 *         opportunities: {
 *           internship: [], event: [], competition: [], other: []
 *           // each item: { id, text, deadline? }
 *         },
 *       },
 *       planning: {
 *         years: {
 *           "2026": { lanes: [ { id, name, colorIdx, events: [ { id, startMonth, span, text, colorIdx } ] } ] }
 *         }
 *       },
 *       nextId: 100,
 *     }
 *
 *   None of the old entities (Goal, Skill, Book, Lang, Friend, Client,
 *   EconomicsRegion...) exist in the frontend anymore, and the frontend's
 *   saveState() now POSTs the *entire* state object directly as the
 *   request body — not wrapped under named keys.
 *
 *   Rather than hand-maintaining a Mongoose schema field-for-field
 *   against a state shape that keeps evolving, this backend stores the
 *   whole state as one JSON document and hands it back verbatim. The
 *   frontend already has its own `mergeDefaults()` / `defaultState()`
 *   logic to backfill anything missing, so the backend doesn't need to
 *   duplicate that structure — it just needs to persist + return it.
 */

require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const path     = require('path');

// ─────────────────────────────────────────────────────────────
// APP INIT
// ─────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '4mb' }));

// ─────────────────────────────────────────────────────────────
// MONGOOSE SCHEMA — single-document JSON blob
// ─────────────────────────────────────────────────────────────
// One document holds the entire app state, keyed by a fixed singleton
// key. `data` is intentionally Mixed/untyped so the frontend's state
// shape can keep changing without backend migrations.
const AppStateSchema = new mongoose.Schema(
  {
    _key: { type: String, default: 'singleton', unique: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
);

const AppState = mongoose.model('AppState', AppStateSchema);

async function getStateDoc() {
  let doc = await AppState.findOne({ _key: 'singleton' });
  if (!doc) {
    doc = await AppState.create({ _key: 'singleton', data: {} });
  }
  return doc;
}

// ─────────────────────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────────────────────

// ── Health ────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status:    'ok',
    db:        mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// ──────────────────────────────────────────────────────────────
// GET /api/state
// Returns the saved state object as-is (or {} if nothing saved yet —
// the frontend's mergeDefaults() fills in the rest).
// ──────────────────────────────────────────────────────────────
app.get('/api/state', async (_req, res) => {
  try {
    const doc = await getStateDoc();
    res.json(doc.data || {});
  } catch (err) {
    console.error('[load]', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// POST /api/state/sync
// Body IS the state object directly (frontend does
// fetch('/api/state/sync', { body: JSON.stringify(state) })).
// We store it whole-cloth, overwriting the previous snapshot.
// ──────────────────────────────────────────────────────────────
app.post('/api/state/sync', async (req, res) => {
  try {
    const incoming = req.body;

    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'Expected a JSON state object in the request body.' });
    }

    await AppState.updateOne(
      { _key: 'singleton' },
      { $set: { data: incoming } },
      { upsert: true }
    );

    res.json({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[sync]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// SERVE FRONTEND
// ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─────────────────────────────────────────────────────────────
// 404 HANDLER
// ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─────────────────────────────────────────────────────────────
// MONGO + START
// ─────────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('\n❌  MONGO_URI is not set.');
  console.error('    Create a .env file with:  MONGO_URI=mongodb+srv://...\n');
  process.exit(1);
}

mongoose
  .connect(MONGO_URI, { serverSelectionTimeoutMS: 8000 })
  .then(() => {
    console.log('✅  MongoDB connected');
    app.listen(PORT, () => {
      console.log(`🚀  GOAL_ENGINE_V3 backend running → http://localhost:${PORT}`);
      console.log(`    API base:  http://localhost:${PORT}/api`);
      console.log(`    Place index.html in ./public/ to serve the frontend`);
    });
  })
  .catch(err => {
    console.error('❌  MongoDB connection failed:', err.message);
    process.exit(1);
  });