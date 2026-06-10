/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║             GOAL_ENGINE_V3 — BACKEND SERVER                 ║
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
app.use(express.json({ limit: '2mb' }));

// ─────────────────────────────────────────────────────────────
// MONGOOSE SCHEMAS
// ─────────────────────────────────────────────────────────────

// ── Goal ──────────────────────────────────────────────────────
const GoalSchema = new mongoose.Schema({
  clientId:   { type: Number, required: true, unique: true }, // original id from frontend
  name:       { type: String, required: true },
  total:      { type: Number, required: true, min: 1, max: 60 },
  output:     { type: String, enum: ['learning', 'earning'], default: 'learning' },
  deadline:   { type: String, required: true },          // ISO date string "YYYY-MM-DD"
  category:   { type: String, required: true },
  catData:    { type: mongoose.Schema.Types.Mixed, default: {} },
  colorIdx:   { type: Number, default: 0 },
  doneSet:    { type: [Number], default: [] },           // array of conquered cell indices
}, { timestamps: true });

// ── Skill ─────────────────────────────────────────────────────
const SkillSchema = new mongoose.Schema({
  clientId:     { type: Number, required: true, unique: true },
  name:         { type: String, required: true },
  confidence:   { type: Number, default: 0, min: 0, max: 100 },
  goalProgress: { type: Number, default: 0, min: 0, max: 100 },
  color:        { type: String, default: 'var(--cyan)' },
}, { timestamps: true });

// ── Book ──────────────────────────────────────────────────────
const BookSchema = new mongoose.Schema({
  clientId:     { type: Number, required: true, unique: true },
  title:        { type: String, required: true },
  author:       { type: String, default: '' },
  pages:        { type: Number, default: 0 },
  read:         { type: Number, default: 0 },
  status:       { type: String, enum: ['queue', 'reading', 'done'], default: 'queue' },
  remembrance:  { type: Number, default: 0, min: 0, max: 100 },
  linkedGoalId: { type: Number, default: null },
}, { timestamps: true });

// ── Language ──────────────────────────────────────────────────
const LangSchema = new mongoose.Schema({
  clientId:     { type: Number, required: true, unique: true },
  name:         { type: String, required: true },
  confidence:   { type: Number, default: 0, min: 0, max: 100 },
  goalProgress: { type: Number, default: 0, min: 0, max: 100 },
}, { timestamps: true });

// ── Friend ────────────────────────────────────────────────────
const FriendSchema = new mongoose.Schema({
  clientId: { type: Number, required: true, unique: true },
  name:     { type: String, required: true },
  role:     { type: String, default: 'Contact' },
}, { timestamps: true });

// ── Client ────────────────────────────────────────────────────
const ClientSchema = new mongoose.Schema({
  clientId:  { type: Number, required: true, unique: true },
  name:      { type: String, required: true },
  platform:  { type: String, default: 'Direct' },
  status:    { type: String, enum: ['prospect', 'active', 'completed'], default: 'prospect' },
}, { timestamps: true });

// ── Settings (social counts + ultimate goal — one singleton doc) ──
const SettingsSchema = new mongoose.Schema({
  _key:    { type: String, default: 'singleton', unique: true },
  social:  {
    instagram: { followers: Number, handle: String },
    youtube:   { subscribers: Number, handle: String },
    linkedin:  { connections: Number, handle: String },
  },
  ultimate: {
    title:    String,
    vision:   String,
    progress: Number,
  },
  nextId: { type: Number, default: 100 },
});

// ── Models ────────────────────────────────────────────────────
const Goal     = mongoose.model('Goal',     GoalSchema);
const Skill    = mongoose.model('Skill',    SkillSchema);
const Book     = mongoose.model('Book',     BookSchema);
const Lang     = mongoose.model('Lang',     LangSchema);
const Friend   = mongoose.model('Friend',   FriendSchema);
const Client   = mongoose.model('Client',   ClientSchema);
const Settings = mongoose.model('Settings', SettingsSchema);

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/** Ensure the Settings singleton always exists */
async function getSettings() {
  let s = await Settings.findOne({ _key: 'singleton' });
  if (!s) {
    s = await Settings.create({
      _key: 'singleton',
      social: {
        instagram: { followers: 0, handle: '' },
        youtube:   { subscribers: 0, handle: '' },
        linkedin:  { connections: 0, handle: '' },
      },
      ultimate: { title: 'YOUR ENDGAME', vision: 'Define your ultimate mission', progress: 0 },
      nextId: 100,
    });
  }
  return s;
}

// ─────────────────────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────────────────────

// ── Health ────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// ──────────────────────────────────────────────────────────────
// FULL-STATE SYNC  (called once on page load and on every save)
// The frontend sends its entire state; the backend does an
// atomic upsert of every collection.  This mirrors the existing
// localStorage approach — the frontend remains the source of
// truth during a session and pushes snapshots to Mongo.
// ──────────────────────────────────────────────────────────────
app.post('/api/state/sync', async (req, res) => {
  try {
    const { goals = [], skills = [], books = [], langs = [],
            friends = [], clients = [], social, ultimate, nextId } = req.body;

    // Helper: upsert array into a model by clientId
    const upsertAll = async (Model, items, transform = x => x) => {
      const ops = items.map(item => ({
        updateOne: {
          filter: { clientId: item.id },
          update: { $set: transform(item) },
          upsert: true,
        },
      }));
      if (ops.length) await Model.bulkWrite(ops);
      // Delete any docs whose clientId is no longer in the list
      const ids = items.map(i => i.id);
      await Model.deleteMany({ clientId: { $nin: ids } });
    };

    await upsertAll(Goal, goals, g => ({
      clientId: g.id, name: g.name, total: g.total,
      output: g.output, deadline: g.deadline,
      category: g.category, catData: g.catData || {},
      colorIdx: g.colorIdx || 0,
      doneSet: Array.isArray(g.doneSet) ? g.doneSet : [...(g.doneSet || [])],
    }));

    await upsertAll(Skill, skills, s => ({
      clientId: s.id, name: s.name,
      confidence: s.confidence || 0,
      goalProgress: s.goalProgress || 0,
      color: s.color || 'var(--cyan)',
    }));

    await upsertAll(Book, books, b => ({
      clientId: b.id, title: b.title, author: b.author || '',
      pages: b.pages || 0, read: b.read || 0,
      status: b.status || 'queue',
      remembrance: b.remembrance || 0,
      linkedGoalId: b.linkedGoalId || null,
    }));

    await upsertAll(Lang, langs, l => ({
      clientId: l.id, name: l.name,
      confidence: l.confidence || 0,
      goalProgress: l.goalProgress || 0,
    }));

    await upsertAll(Friend, friends, f => ({
      clientId: f.id, name: f.name, role: f.role || 'Contact',
    }));

    await upsertAll(Client, clients, c => ({
      clientId: c.id, name: c.name,
      platform: c.platform || 'Direct',
      status: c.status || 'prospect',
    }));

    // Settings singleton
    const settingsUpdate = {};
    if (social)   settingsUpdate.social   = social;
    if (ultimate) settingsUpdate.ultimate = ultimate;
    if (nextId)   settingsUpdate.nextId   = nextId;

    if (Object.keys(settingsUpdate).length) {
      await Settings.updateOne(
        { _key: 'singleton' },
        { $set: settingsUpdate },
        { upsert: true }
      );
    }

    res.json({ ok: true, synced: { goals: goals.length, skills: skills.length,
      books: books.length, langs: langs.length, friends: friends.length,
      clients: clients.length } });
  } catch (err) {
    console.error('[sync]', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// FULL-STATE LOAD  (called on page load to hydrate the frontend)
// ──────────────────────────────────────────────────────────────
app.get('/api/state', async (req, res) => {
  try {
    const [goals, skills, books, langs, friends, clients, settings] = await Promise.all([
      Goal.find().sort({ createdAt: 1 }).lean(),
      Skill.find().sort({ createdAt: 1 }).lean(),
      Book.find().sort({ createdAt: 1 }).lean(),
      Lang.find().sort({ createdAt: 1 }).lean(),
      Friend.find().sort({ createdAt: 1 }).lean(),
      Client.find().sort({ createdAt: 1 }).lean(),
      getSettings(),
    ]);

    // Map Mongo docs back to the shape the frontend expects
    const mapGoal = g => ({
      id: g.clientId, name: g.name, total: g.total,
      output: g.output, deadline: g.deadline,
      category: g.category, catData: g.catData || {},
      colorIdx: g.colorIdx || 0,
      doneSet: g.doneSet || [],   // frontend will re-wrap in Set
    });

    res.json({
      goals:    goals.map(mapGoal),
      skills:   skills.map(s => ({ id: s.clientId, name: s.name, confidence: s.confidence, goalProgress: s.goalProgress, color: s.color })),
      books:    books.map(b => ({ id: b.clientId, title: b.title, author: b.author, pages: b.pages, read: b.read, status: b.status, remembrance: b.remembrance, linkedGoalId: b.linkedGoalId })),
      langs:    langs.map(l => ({ id: l.clientId, name: l.name, confidence: l.confidence, goalProgress: l.goalProgress })),
      friends:  friends.map(f => ({ id: f.clientId, name: f.name, role: f.role })),
      clients:  clients.map(c => ({ id: c.clientId, name: c.name, platform: c.platform, status: c.status })),
      social:   settings.social   || {},
      ultimate: settings.ultimate || {},
      nextId:   settings.nextId   || 100,
    });
  } catch (err) {
    console.error('[load]', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// GRANULAR ENDPOINTS (optional — frontend can also use full sync)
// ──────────────────────────────────────────────────────────────

// ── Goals ─────────────────────────────────────────────────────
app.get('/api/goals', async (_req, res) => {
  const docs = await Goal.find().sort({ createdAt: 1 }).lean();
  res.json(docs.map(g => ({ ...g, id: g.clientId })));
});

app.post('/api/goals', async (req, res) => {
  try {
    const g = req.body;
    const doc = await Goal.create({
      clientId: g.id, name: g.name, total: g.total,
      output: g.output, deadline: g.deadline,
      category: g.category, catData: g.catData || {},
      colorIdx: g.colorIdx || 0,
      doneSet: Array.isArray(g.doneSet) ? g.doneSet : [...(g.doneSet || [])],
    });
    res.status(201).json({ ok: true, id: doc.clientId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/goals/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const update = req.body;
    // Convert doneSet if sent as Set or Array
    if (update.doneSet) {
      update.doneSet = Array.isArray(update.doneSet)
        ? update.doneSet
        : [...update.doneSet];
    }
    await Goal.updateOne({ clientId: id }, { $set: update });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/goals/:id', async (req, res) => {
  await Goal.deleteOne({ clientId: parseInt(req.params.id) });
  res.json({ ok: true });
});

// ── Skills ────────────────────────────────────────────────────
app.get('/api/skills', async (_req, res) => {
  const docs = await Skill.find().sort({ createdAt: 1 }).lean();
  res.json(docs.map(s => ({ ...s, id: s.clientId })));
});

app.post('/api/skills', async (req, res) => {
  try {
    const s = req.body;
    await Skill.create({ clientId: s.id, name: s.name, confidence: s.confidence || 0, goalProgress: 0, color: s.color });
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/skills/:id', async (req, res) => {
  await Skill.updateOne({ clientId: parseInt(req.params.id) }, { $set: req.body });
  res.json({ ok: true });
});

app.delete('/api/skills/:id', async (req, res) => {
  await Skill.deleteOne({ clientId: parseInt(req.params.id) });
  res.json({ ok: true });
});

// ── Books ─────────────────────────────────────────────────────
app.get('/api/books', async (_req, res) => {
  const docs = await Book.find().sort({ createdAt: 1 }).lean();
  res.json(docs.map(b => ({ ...b, id: b.clientId })));
});

app.post('/api/books', async (req, res) => {
  try {
    const b = req.body;
    await Book.create({ clientId: b.id, title: b.title, author: b.author || '', pages: b.pages || 0, read: b.read || 0, status: b.status || 'queue', remembrance: 0, linkedGoalId: b.linkedGoalId || null });
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/books/:id', async (req, res) => {
  await Book.updateOne({ clientId: parseInt(req.params.id) }, { $set: req.body });
  res.json({ ok: true });
});

app.delete('/api/books/:id', async (req, res) => {
  await Book.deleteOne({ clientId: parseInt(req.params.id) });
  res.json({ ok: true });
});

// ── Languages ─────────────────────────────────────────────────
app.get('/api/langs', async (_req, res) => {
  const docs = await Lang.find().sort({ createdAt: 1 }).lean();
  res.json(docs.map(l => ({ ...l, id: l.clientId })));
});

app.post('/api/langs', async (req, res) => {
  try {
    const l = req.body;
    await Lang.create({ clientId: l.id, name: l.name, confidence: l.confidence || 0, goalProgress: 0 });
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/langs/:id', async (req, res) => {
  await Lang.updateOne({ clientId: parseInt(req.params.id) }, { $set: req.body });
  res.json({ ok: true });
});

app.delete('/api/langs/:id', async (req, res) => {
  await Lang.deleteOne({ clientId: parseInt(req.params.id) });
  res.json({ ok: true });
});

// ── Friends ───────────────────────────────────────────────────
app.get('/api/friends', async (_req, res) => {
  const docs = await Friend.find().sort({ createdAt: 1 }).lean();
  res.json(docs.map(f => ({ ...f, id: f.clientId })));
});

app.post('/api/friends', async (req, res) => {
  try {
    const f = req.body;
    await Friend.create({ clientId: f.id, name: f.name, role: f.role || 'Contact' });
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/friends/:id', async (req, res) => {
  await Friend.deleteOne({ clientId: parseInt(req.params.id) });
  res.json({ ok: true });
});

// ── Clients ───────────────────────────────────────────────────
app.get('/api/clients', async (_req, res) => {
  const docs = await Client.find().sort({ createdAt: 1 }).lean();
  res.json(docs.map(c => ({ ...c, id: c.clientId })));
});

app.post('/api/clients', async (req, res) => {
  try {
    const c = req.body;
    await Client.create({ clientId: c.id, name: c.name, platform: c.platform || 'Direct', status: c.status || 'prospect' });
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/clients/:id', async (req, res) => {
  await Client.updateOne({ clientId: parseInt(req.params.id) }, { $set: req.body });
  res.json({ ok: true });
});

app.delete('/api/clients/:id', async (req, res) => {
  await Client.deleteOne({ clientId: parseInt(req.params.id) });
  res.json({ ok: true });
});

// ── Settings (social + ultimate) ──────────────────────────────
app.get('/api/settings', async (_req, res) => {
  const s = await getSettings();
  res.json({ social: s.social, ultimate: s.ultimate, nextId: s.nextId });
});

app.patch('/api/settings', async (req, res) => {
  try {
    await Settings.updateOne({ _key: 'singleton' }, { $set: req.body }, { upsert: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// SERVE FRONTEND  (place your index.html in ./public/)
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
      console.log(`    API base: http://localhost:${PORT}/api`);
      console.log(`    Place index.html in ./public/  to serve the frontend`);
    });
  })
  .catch(err => {
    console.error('❌  MongoDB connection failed:', err.message);
    process.exit(1);
  });