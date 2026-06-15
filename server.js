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
 *
 * FIXES IN THIS VERSION:
 *   - Economics regions now saved/loaded (new EconomicsRegion model)
 *   - Lifestyle daily log now saved/loaded (new LifestyleDay model)
 *   - Friends: all fields (phone, dob, guardian, address, notes) fully persisted
 *   - Social counts (instagram/youtube/linkedin) reliably persisted
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
app.use(express.json({ limit: '4mb' })); // bumped limit for lifestyle logs

// ─────────────────────────────────────────────────────────────
// MONGOOSE SCHEMAS
// ─────────────────────────────────────────────────────────────

// ── Goal ──────────────────────────────────────────────────────
const GoalSchema = new mongoose.Schema({
  clientId:   { type: Number, required: true, unique: true },
  name:       { type: String, required: true },
  total:      { type: Number, required: true, min: 1, max: 90 },
  output:     { type: String, enum: ['learning', 'earning'], default: 'learning' },
  deadline:   { type: String, required: true },
  category:   { type: String, required: true },
  catData:    { type: mongoose.Schema.Types.Mixed, default: {} },
  colorIdx:   { type: Number, default: 0 },
  doneSet:    { type: [Number], default: [] },
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

// ── Friend — all contact fields ───────────────────────────────
const FriendSchema = new mongoose.Schema({
  clientId:  { type: Number, required: true, unique: true },
  name:      { type: String, required: true },
  role:      { type: String, default: 'Contact' },
  phone:     { type: String, default: '' },
  dob:       { type: String, default: '' },
  guardian:  { type: String, default: '' },
  address:   { type: String, default: '' },
  notes:     { type: String, default: '' },
}, { timestamps: true });

// ── Client ────────────────────────────────────────────────────
const ClientSchema = new mongoose.Schema({
  clientId:  { type: Number, required: true, unique: true },
  name:      { type: String, required: true },
  platform:  { type: String, default: 'Direct' },
  status:    { type: String, enum: ['prospect', 'active', 'completed'], default: 'prospect' },
}, { timestamps: true });

// ── PlanningEvent (sub-schema) ────────────────────────────────
const PlanningEventSchema = new mongoose.Schema({
  id:          { type: Number, required: true },
  startMonth:  { type: Number, required: true, min: 0, max: 11 },
  span:        { type: Number, default: 1, min: 1, max: 12 },
  text:        { type: String, required: true },
  colorIdx:    { type: Number, default: 0 },
}, { _id: false });

// ── PlanningLane ──────────────────────────────────────────────
const PlanningLaneSchema = new mongoose.Schema({
  clientId:  { type: Number, required: true, unique: true },
  year:      { type: Number, required: true },
  name:      { type: String, required: true },
  colorIdx:  { type: Number, default: 0 },
  events:    { type: [PlanningEventSchema], default: [] },
}, { timestamps: true });

// ── Economics Region (NEW) ────────────────────────────────────
// Each mapped region on the geo-intel map is one document.
// `data` is a free-form array of { key, val } pairs the user adds.
const EconomicsRegionSchema = new mongoose.Schema({
  clientId:  { type: Number, required: true, unique: true }, // region.id from frontend
  title:     { type: String, required: true },
  colorIdx:  { type: Number, default: 0 },
  // bounds: { sw: [lat, lng], ne: [lat, lng] }
  bounds: {
    sw: { type: [Number], required: true },  // [lat, lng]
    ne: { type: [Number], required: true },  // [lat, lng]
  },
  // arbitrary key-value data rows e.g. [{ key: 'GDP', val: '$2.1T' }]
  data: {
    type: [{ key: String, val: String, _id: false }],
    default: [],
  },
}, { timestamps: true });

// ── Lifestyle Day (NEW) ───────────────────────────────────────
// One document per calendar day. `entries` mirrors the frontend array
// stored under state.lifestyle.log['YYYY-MM-DD'].
// We store every entry as a Mixed object so any activity shape is accepted.
const LifestyleDaySchema = new mongoose.Schema({
  dateKey: { type: String, required: true, unique: true }, // 'YYYY-MM-DD'
  entries: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true });

// ── Settings (social + ultimate + planning year — singleton) ──
const SettingsSchema = new mongoose.Schema({
  _key:    { type: String, default: 'singleton', unique: true },
  social: {
    instagram: { followers: { type: Number, default: 0 }, handle: { type: String, default: '' } },
    youtube:   { subscribers: { type: Number, default: 0 }, handle: { type: String, default: '' } },
    linkedin:  { connections: { type: Number, default: 0 }, handle: { type: String, default: '' } },
  },
  ultimate: {
    title:    { type: String, default: 'YOUR ENDGAME' },
    vision:   { type: String, default: 'Define your ultimate mission' },
    progress: { type: Number, default: 0 },
  },
  planningYear: { type: Number, default: null },
  nextId: { type: Number, default: 100 },
});

// ── Models ────────────────────────────────────────────────────
const Goal             = mongoose.model('Goal',             GoalSchema);
const Skill            = mongoose.model('Skill',            SkillSchema);
const Book             = mongoose.model('Book',             BookSchema);
const Lang             = mongoose.model('Lang',             LangSchema);
const Friend           = mongoose.model('Friend',           FriendSchema);
const Client           = mongoose.model('Client',           ClientSchema);
const PlanningLane     = mongoose.model('PlanningLane',     PlanningLaneSchema);
const EconomicsRegion  = mongoose.model('EconomicsRegion',  EconomicsRegionSchema);
const LifestyleDay     = mongoose.model('LifestyleDay',     LifestyleDaySchema);
const Settings         = mongoose.model('Settings',         SettingsSchema);

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

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
      ultimate:    { title: 'YOUR ENDGAME', vision: 'Define your ultimate mission', progress: 0 },
      planningYear: new Date().getFullYear(),
      nextId:      100,
    });
  }
  return s;
}

// Generic upsert-all helper: syncs an array of items into a model,
// deletes any documents whose clientId is no longer in the list.
async function upsertAll(Model, items, transform) {
  if (!items || !items.length) {
    // Nothing to upsert — but still delete orphans (all docs)
    await Model.deleteMany({});
    return;
  }
  const ops = items.map(item => ({
    updateOne: {
      filter: { clientId: item.id },
      update:  { $set: transform(item) },
      upsert:  true,
    },
  }));
  await Model.bulkWrite(ops);
  const ids = items.map(i => i.id);
  await Model.deleteMany({ clientId: { $nin: ids } });
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
// FULL-STATE SYNC  (POST /api/state/sync)
// This is the only endpoint the frontend actually calls on save.
// ──────────────────────────────────────────────────────────────
app.post('/api/state/sync', async (req, res) => {
  try {
    const {
      goals    = [],
      skills   = [],
      books    = [],
      langs    = [],
      friends  = [],
      clients  = [],
      social,
      ultimate,
      nextId,
      planning,
      economics,   // { regions: [...] }
      lifestyle,   // { log: { 'YYYY-MM-DD': [...entries] } }
    } = req.body;

    // ── Goals ────────────────────────────────────────────────
    await upsertAll(Goal, goals, g => ({
      clientId: g.id,
      name:     g.name,
      total:    g.total,
      output:   g.output,
      deadline: g.deadline,
      category: g.category,
      catData:  g.catData  || {},
      colorIdx: g.colorIdx || 0,
      doneSet:  Array.isArray(g.doneSet) ? g.doneSet : [...(g.doneSet || [])],
    }));

    // ── Skills ───────────────────────────────────────────────
    await upsertAll(Skill, skills, s => ({
      clientId:     s.id,
      name:         s.name,
      confidence:   s.confidence   || 0,
      goalProgress: s.goalProgress || 0,
      color:        s.color        || 'var(--cyan)',
    }));

    // ── Books ────────────────────────────────────────────────
    await upsertAll(Book, books, b => ({
      clientId:     b.id,
      title:        b.title,
      author:       b.author       || '',
      pages:        b.pages        || 0,
      read:         b.read         || 0,
      status:       b.status       || 'queue',
      remembrance:  b.remembrance  || 0,
      linkedGoalId: b.linkedGoalId || null,
    }));

    // ── Languages ────────────────────────────────────────────
    await upsertAll(Lang, langs, l => ({
      clientId:     l.id,
      name:         l.name,
      confidence:   l.confidence   || 0,
      goalProgress: l.goalProgress || 0,
    }));

    // ── Friends ──────────────────────────────────────────────
    await upsertAll(Friend, friends, f => ({
      clientId: f.id,
      name:     f.name,
      role:     f.role     || 'Contact',
      phone:    f.phone    || '',
      dob:      f.dob      || '',
      guardian: f.guardian || '',
      address:  f.address  || '',
      notes:    f.notes    || '',
    }));

    // ── Clients ──────────────────────────────────────────────
    await upsertAll(Client, clients, c => ({
      clientId: c.id,
      name:     c.name,
      platform: c.platform || 'Direct',
      status:   c.status   || 'prospect',
    }));

    // ── Planning ─────────────────────────────────────────────
    if (planning) {
      const lanes    = planning.lanes || [];
      const planYear = planning.year  || new Date().getFullYear();

      await upsertAll(PlanningLane, lanes, lane => ({
        clientId: lane.id,
        year:     planYear,
        name:     lane.name,
        colorIdx: lane.colorIdx || 0,
        events:   (lane.events || []).map(ev => ({
          id:         ev.id,
          startMonth: ev.startMonth,
          span:       ev.span     || 1,
          text:       ev.text,
          colorIdx:   ev.colorIdx || 0,
        })),
      }));
    }

    // ── Economics Regions (NEW) ───────────────────────────────
    // state.economics = { regions: [ { id, title, colorIdx, bounds, data } ] }
    if (economics) {
      const regions = economics.regions || [];
      await upsertAll(EconomicsRegion, regions, r => ({
        clientId: r.id,
        title:    r.title    || 'REGION',
        colorIdx: r.colorIdx || 0,
        bounds:   {
          sw: r.bounds.sw,   // [lat, lng]
          ne: r.bounds.ne,   // [lat, lng]
        },
        data: (r.data || []).map(row => ({ key: row.key || '', val: row.val || '' })),
      }));
    }

    // ── Lifestyle Daily Log (NEW) ─────────────────────────────
    // state.lifestyle = { log: { 'YYYY-MM-DD': [ ...entries ] } }
    // Strategy: upsert one LifestyleDay doc per date key that has entries.
    // Delete docs for dates that are no longer in the log (or have empty arrays).
    if (lifestyle && lifestyle.log) {
      const log = lifestyle.log;
      const dateKeys = Object.keys(log).filter(dk => log[dk] && log[dk].length > 0);

      const lsOps = dateKeys.map(dk => ({
        updateOne: {
          filter: { dateKey: dk },
          update:  { $set: { dateKey: dk, entries: log[dk] } },
          upsert:  true,
        },
      }));

      if (lsOps.length) await LifestyleDay.bulkWrite(lsOps);

      // Remove days that were cleared (empty array or key removed)
      if (dateKeys.length > 0) {
        await LifestyleDay.deleteMany({ dateKey: { $nin: dateKeys } });
      } else {
        // No entries at all — wipe everything
        await LifestyleDay.deleteMany({});
      }
    }

    // ── Settings (social + ultimate + nextId + planning year) ─
    const settingsUpdate = {};
    if (social)         settingsUpdate.social        = social;
    if (ultimate)       settingsUpdate.ultimate      = ultimate;
    if (nextId)         settingsUpdate.nextId        = nextId;
    if (planning?.year) settingsUpdate.planningYear  = planning.year;

    if (Object.keys(settingsUpdate).length) {
      await Settings.updateOne(
        { _key: 'singleton' },
        { $set: settingsUpdate },
        { upsert: true }
      );
    }

    res.json({
      ok: true,
      synced: {
        goals:           goals.length,
        skills:          skills.length,
        books:           books.length,
        langs:           langs.length,
        friends:         friends.length,
        clients:         clients.length,
        planningLanes:   planning?.lanes?.length  ?? 0,
        economicsRegions: (economics?.regions?.length) ?? 0,
        lifestyleDays:   lifestyle?.log
          ? Object.keys(lifestyle.log).filter(dk => (lifestyle.log[dk]||[]).length > 0).length
          : 0,
      },
    });
  } catch (err) {
    console.error('[sync]', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// FULL-STATE LOAD  (GET /api/state)
// ──────────────────────────────────────────────────────────────
app.get('/api/state', async (_req, res) => {
  try {
    const [
      goals, skills, books, langs, friends, clients,
      planningLanes, econRegions, lifestyleDays, settings,
    ] = await Promise.all([
      Goal.find().sort({ createdAt: 1 }).lean(),
      Skill.find().sort({ createdAt: 1 }).lean(),
      Book.find().sort({ createdAt: 1 }).lean(),
      Lang.find().sort({ createdAt: 1 }).lean(),
      Friend.find().sort({ createdAt: 1 }).lean(),
      Client.find().sort({ createdAt: 1 }).lean(),
      PlanningLane.find().sort({ createdAt: 1 }).lean(),
      EconomicsRegion.find().sort({ createdAt: 1 }).lean(),
      LifestyleDay.find().sort({ dateKey: 1 }).lean(),
      getSettings(),
    ]);

    // ── Rebuild planning ──────────────────────────────────────
    const planYear = settings.planningYear || new Date().getFullYear();
    const planning = {
      year:  planYear,
      lanes: planningLanes.map(l => ({
        id:       l.clientId,
        name:     l.name,
        colorIdx: l.colorIdx || 0,
        events:   (l.events || []).map(ev => ({
          id:         ev.id,
          startMonth: ev.startMonth,
          span:       ev.span     || 1,
          text:       ev.text,
          colorIdx:   ev.colorIdx || 0,
        })),
      })),
    };

    // ── Rebuild economics ─────────────────────────────────────
    const economics = {
      regions: econRegions.map(r => ({
        id:       r.clientId,
        title:    r.title,
        colorIdx: r.colorIdx || 0,
        bounds:   { sw: r.bounds.sw, ne: r.bounds.ne },
        data:     (r.data || []).map(row => ({ key: row.key, val: row.val })),
      })),
    };

    // ── Rebuild lifestyle log ─────────────────────────────────
    // Reconstruct as { 'YYYY-MM-DD': [...entries] }
    const lifestyleLog = {};
    lifestyleDays.forEach(day => {
      lifestyleLog[day.dateKey] = day.entries || [];
    });
    const lifestyle = { log: lifestyleLog };

    res.json({
      goals: goals.map(g => ({
        id:       g.clientId,
        name:     g.name,
        total:    g.total,
        output:   g.output,
        deadline: g.deadline,
        category: g.category,
        catData:  g.catData  || {},
        colorIdx: g.colorIdx || 0,
        doneSet:  g.doneSet  || [],
      })),
      skills: skills.map(s => ({
        id:           s.clientId,
        name:         s.name,
        confidence:   s.confidence,
        goalProgress: s.goalProgress,
        color:        s.color,
      })),
      books: books.map(b => ({
        id:           b.clientId,
        title:        b.title,
        author:       b.author,
        pages:        b.pages,
        read:         b.read,
        status:       b.status,
        remembrance:  b.remembrance,
        linkedGoalId: b.linkedGoalId,
      })),
      langs: langs.map(l => ({
        id:           l.clientId,
        name:         l.name,
        confidence:   l.confidence,
        goalProgress: l.goalProgress,
      })),
      friends: friends.map(f => ({
        id:       f.clientId,
        name:     f.name,
        role:     f.role,
        phone:    f.phone    || '',
        dob:      f.dob      || '',
        guardian: f.guardian || '',
        address:  f.address  || '',
        notes:    f.notes    || '',
      })),
      clients: clients.map(c => ({
        id:       c.clientId,
        name:     c.name,
        platform: c.platform,
        status:   c.status,
      })),
      social:   settings.social   || {
        instagram: { followers: 0, handle: '' },
        youtube:   { subscribers: 0, handle: '' },
        linkedin:  { connections: 0, handle: '' },
      },
      ultimate: settings.ultimate || { title: 'YOUR ENDGAME', vision: '', progress: 0 },
      nextId:   settings.nextId   || 100,
      planning,
      economics,
      lifestyle,
    });
  } catch (err) {
    console.error('[load]', err);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────────
// GRANULAR ENDPOINTS (kept for future use / debugging)
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
      category: g.category, catData: g.catData || {}, colorIdx: g.colorIdx || 0,
      doneSet: Array.isArray(g.doneSet) ? g.doneSet : [...(g.doneSet || [])],
    });
    res.status(201).json({ ok: true, id: doc.clientId });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.patch('/api/goals/:id', async (req, res) => {
  const update = req.body;
  if (update.doneSet) update.doneSet = Array.isArray(update.doneSet) ? update.doneSet : [...update.doneSet];
  await Goal.updateOne({ clientId: parseInt(req.params.id) }, { $set: update });
  res.json({ ok: true });
});
app.delete('/api/goals/:id', async (req, res) => {
  await Goal.deleteOne({ clientId: parseInt(req.params.id) }); res.json({ ok: true });
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
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.patch('/api/skills/:id', async (req, res) => {
  await Skill.updateOne({ clientId: parseInt(req.params.id) }, { $set: req.body }); res.json({ ok: true });
});
app.delete('/api/skills/:id', async (req, res) => {
  await Skill.deleteOne({ clientId: parseInt(req.params.id) }); res.json({ ok: true });
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
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.patch('/api/books/:id', async (req, res) => {
  await Book.updateOne({ clientId: parseInt(req.params.id) }, { $set: req.body }); res.json({ ok: true });
});
app.delete('/api/books/:id', async (req, res) => {
  await Book.deleteOne({ clientId: parseInt(req.params.id) }); res.json({ ok: true });
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
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.patch('/api/langs/:id', async (req, res) => {
  await Lang.updateOne({ clientId: parseInt(req.params.id) }, { $set: req.body }); res.json({ ok: true });
});
app.delete('/api/langs/:id', async (req, res) => {
  await Lang.deleteOne({ clientId: parseInt(req.params.id) }); res.json({ ok: true });
});

// ── Friends ───────────────────────────────────────────────────
app.get('/api/friends', async (_req, res) => {
  const docs = await Friend.find().sort({ createdAt: 1 }).lean();
  res.json(docs.map(f => ({
    id: f.clientId, name: f.name, role: f.role,
    phone: f.phone || '', dob: f.dob || '',
    guardian: f.guardian || '', address: f.address || '', notes: f.notes || '',
  })));
});
app.post('/api/friends', async (req, res) => {
  try {
    const f = req.body;
    await Friend.create({
      clientId: f.id, name: f.name, role: f.role || 'Contact',
      phone: f.phone || '', dob: f.dob || '',
      guardian: f.guardian || '', address: f.address || '', notes: f.notes || '',
    });
    res.status(201).json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.patch('/api/friends/:id', async (req, res) => {
  await Friend.updateOne({ clientId: parseInt(req.params.id) }, { $set: req.body }); res.json({ ok: true });
});
app.delete('/api/friends/:id', async (req, res) => {
  await Friend.deleteOne({ clientId: parseInt(req.params.id) }); res.json({ ok: true });
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
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.patch('/api/clients/:id', async (req, res) => {
  await Client.updateOne({ clientId: parseInt(req.params.id) }, { $set: req.body }); res.json({ ok: true });
});
app.delete('/api/clients/:id', async (req, res) => {
  await Client.deleteOne({ clientId: parseInt(req.params.id) }); res.json({ ok: true });
});

// ── Planning ──────────────────────────────────────────────────
app.get('/api/planning', async (_req, res) => {
  try {
    const settings = await getSettings();
    const lanes = await PlanningLane.find().sort({ createdAt: 1 }).lean();
    res.json({
      year:  settings.planningYear || new Date().getFullYear(),
      lanes: lanes.map(l => ({ id: l.clientId, name: l.name, colorIdx: l.colorIdx, events: l.events || [] })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/planning/lanes', async (req, res) => {
  try {
    const l = req.body;
    await PlanningLane.create({ clientId: l.id, year: l.year || new Date().getFullYear(), name: l.name, colorIdx: l.colorIdx || 0, events: l.events || [] });
    res.status(201).json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.patch('/api/planning/lanes/:id', async (req, res) => {
  await PlanningLane.updateOne({ clientId: parseInt(req.params.id) }, { $set: req.body }); res.json({ ok: true });
});
app.delete('/api/planning/lanes/:id', async (req, res) => {
  await PlanningLane.deleteOne({ clientId: parseInt(req.params.id) }); res.json({ ok: true });
});

// ── Economics Regions (NEW granular endpoints) ────────────────
app.get('/api/economics/regions', async (_req, res) => {
  const docs = await EconomicsRegion.find().sort({ createdAt: 1 }).lean();
  res.json(docs.map(r => ({
    id: r.clientId, title: r.title, colorIdx: r.colorIdx,
    bounds: { sw: r.bounds.sw, ne: r.bounds.ne },
    data:   r.data || [],
  })));
});
app.post('/api/economics/regions', async (req, res) => {
  try {
    const r = req.body;
    await EconomicsRegion.create({
      clientId: r.id, title: r.title || 'REGION', colorIdx: r.colorIdx || 0,
      bounds: { sw: r.bounds.sw, ne: r.bounds.ne },
      data:   (r.data || []).map(row => ({ key: row.key || '', val: row.val || '' })),
    });
    res.status(201).json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.patch('/api/economics/regions/:id', async (req, res) => {
  await EconomicsRegion.updateOne({ clientId: parseInt(req.params.id) }, { $set: req.body }); res.json({ ok: true });
});
app.delete('/api/economics/regions/:id', async (req, res) => {
  await EconomicsRegion.deleteOne({ clientId: parseInt(req.params.id) }); res.json({ ok: true });
});

// ── Lifestyle (NEW granular endpoints) ────────────────────────
app.get('/api/lifestyle', async (_req, res) => {
  const docs = await LifestyleDay.find().sort({ dateKey: 1 }).lean();
  const log = {};
  docs.forEach(d => { log[d.dateKey] = d.entries || []; });
  res.json({ log });
});
app.put('/api/lifestyle/:dateKey', async (req, res) => {
  // Full replace of a single day's entries
  try {
    const { dateKey } = req.params;
    const { entries = [] } = req.body;
    await LifestyleDay.updateOne({ dateKey }, { $set: { dateKey, entries } }, { upsert: true });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.delete('/api/lifestyle/:dateKey', async (req, res) => {
  await LifestyleDay.deleteOne({ dateKey: req.params.dateKey }); res.json({ ok: true });
});

// ── Settings ──────────────────────────────────────────────────
app.get('/api/settings', async (_req, res) => {
  const s = await getSettings();
  res.json({ social: s.social, ultimate: s.ultimate, nextId: s.nextId, planningYear: s.planningYear });
});
app.patch('/api/settings', async (req, res) => {
  try {
    await Settings.updateOne({ _key: 'singleton' }, { $set: req.body }, { upsert: true });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
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