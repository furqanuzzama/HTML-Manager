/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║             GOAL_ENGINE_V3 — BACKEND SERVER (v5)             ║
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
 * WHAT'S NEW IN v5 — OPPORTUNITY WIRE:
 *   A second, completely separate collection (`WireArticle`) backs a
 *   read-only "newspaper" feed on the Professional tab. It does NOT
 *   touch the AppState singleton document that the kanban/pinboard/
 *   planner use — the wire is intentionally decoupled so refreshing
 *   it can never clobber the user's manually-curated tracker boards.
 *
 *   GET  /api/opportunities/wire        → list all wire articles
 *   POST /api/opportunities/wire/seed   → replace the wire with a
 *                                          fresh batch (used when you
 *                                          want to push updated
 *                                          research in; wipes + re-
 *                                          inserts, does not merge)
 *
 *   On first boot, if the wire collection is empty, it's auto-seeded
 *   from WIRE_SEED below (research current as of Aug 2026). To refresh
 *   later with newer listings, replace WIRE_SEED and POST to
 *   /api/opportunities/wire/seed, or just call reseedWire() again.
 *
 *   NOTE ON "LIVE" FETCHING: there is no public API for DRDO, SIH,
 *   E-Cell, Yuva Sangam, etc. — this endpoint serves curated data
 *   from Mongo, not a live scrape. If you want true automation, the
 *   place to add it is a scheduled job (node-cron) that scrapes/
 *   parses each source and calls reseedWire()/upserts into
 *   WireArticle on a timer. That's a meaningfully bigger project
 *   (site-specific scrapers, breakage risk, ToS considerations per
 *   site) — flagging it here rather than pretending it's already wired up.
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
// MONGOOSE SCHEMA — AppState (tracker boards, unchanged from v4)
// ─────────────────────────────────────────────────────────────
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
// MONGOOSE SCHEMA — WireArticle (opportunity feed, separate collection)
// ─────────────────────────────────────────────────────────────
const WireArticleSchema = new mongoose.Schema(
  {
    category: { type: String, enum: ['internship', 'event', 'competition', 'other'], required: true },
    title:    { type: String, required: true },
    blurb:    { type: String, default: '' },
    deadline: { type: String, default: null }, // 'YYYY-MM-DD' or null for rolling/ongoing
    url:      { type: String, default: '' },
    source:   { type: String, default: '' },   // display name, e.g. "drdo.gov.in"
  },
  { timestamps: true }
);
const WireArticle = mongoose.model('WireArticle', WireArticleSchema);

// Curated research batch — refresh this array and POST /api/opportunities/wire/seed
// (or restart with an empty collection) whenever you want new listings pushed in.
const WIRE_SEED = [
  {
    category: 'internship',
    title: 'DRDO Paid Internships — lab-by-lab notifications',
    blurb: 'No single DRDO portal — DIPAS, DMSRDE, SAG and other labs post separate paid internship notices through the year. Mechanical/electrical/CS vacancies rotate by lab.',
    deadline: null,
    url: 'https://drdo.gov.in/drdo/en/search/node?keys=Internship',
    source: 'drdo.gov.in',
  },
  {
    category: 'internship',
    title: 'ISRO Internships — VSSC / URSC / SAC',
    blurb: 'General internship + Project Trainee Scheme (needs 6th semester completed). Cycles run summer (Apr–Jul), monsoon (Aug–Oct), winter (Dec–Jan), ~45 days each.',
    deadline: null,
    url: 'https://www.isro.gov.in',
    source: 'isro.gov.in',
  },
  {
    category: 'internship',
    title: 'IIRS Dehradun External Student Internship',
    blurb: 'Rolling admissions for UG/PG/PhD students in remote sensing & space tech. Requires a faculty sponsor and a college NOC.',
    deadline: null,
    url: 'https://www.iirs.gov.in',
    source: 'iirs.gov.in',
  },
  {
    category: 'internship',
    title: 'DAAD WISE — Germany research internship',
    blurb: 'Fully funded, ~€861/month + travel + insurance, 2–3 months at a German university. You must secure a professor\u2019s acceptance BEFORE applying — start outreach now for the Oct window.',
    deadline: '2026-10-01',
    url: 'https://www.daad.de/wise',
    source: 'daad.de',
  },
  {
    category: 'event',
    title: 'Yuva Sangam Phase VII',
    blurb: 'Fully funded 5–7 day cultural/educational exchange to a paired state, open to ages 18–30. Register on the EBSB portal.',
    deadline: '2026-08-18',
    url: 'https://ebsb.aicte-india.org',
    source: 'ebsb.aicte-india.org',
  },
  {
    category: 'competition',
    title: 'Smart India Hackathon (SIH) 2026',
    blurb: 'Ministry of Education\u2019s national hackathon. Teams of 6 (min. 1 female member) solve real government/PSU problem statements through your college SPOC.',
    deadline: '2026-08-10',
    url: 'https://sih.gov.in',
    source: 'sih.gov.in',
  },
  {
    category: 'competition',
    title: 'SUPRA SAEINDIA — Formula Student',
    blurb: '13th edition, Buddh International Circuit, Sept 2–5, 2026. This build cycle is underway — watch for next season\u2019s team registration.',
    deadline: '2026-09-02',
    url: 'https://www.suprasaeindia.org',
    source: 'suprasaeindia.org',
  },
  {
    category: 'competition',
    title: 'BAJA SAEINDIA 2027',
    blurb: 'All-terrain vehicle design/build competition for mechanical & automotive undergrads. Rules and team registration typically open Sept–Oct.',
    deadline: '2026-10-01',
    url: 'https://www.bajasaeindia.org',
    source: 'bajasaeindia.org',
  },
  {
    category: 'competition',
    title: 'Eureka! — E-Cell IIT Bombay',
    blurb: 'Asia\u2019s largest business model competition. Zonal round first, then business model & pitch rounds with mentoring and funding access.',
    deadline: '2026-09-15',
    url: 'https://www.ecell.in/eureka',
    source: 'ecell.in',
  },
  {
    category: 'other',
    title: 'SAE Aerothon / ADDC / IIT Hyderabad Drone Challenge',
    blurb: 'Drone design-build-fly competitions testing aerodynamics, autonomy and control. Watch for next season\u2019s dates.',
    deadline: null,
    url: 'https://www.suprasaeindia.org',
    source: 'suprasaeindia.org',
  },
  {
    category: 'other',
    title: 'International Rover Challenge / Space Drone Challenge — MIT Manipal',
    blurb: 'Mars-analogue terrain competition for student-built rovers and aerial drones, drawing international teams (Poland, TU Berlin) alongside IITs/BITS.',
    deadline: null,
    url: 'https://www.manipal.edu',
    source: 'manipal.edu',
  },
];

async function reseedWire() {
  await WireArticle.deleteMany({});
  await WireArticle.insertMany(WIRE_SEED);
  console.log(`🗞️   Opportunity Wire seeded with ${WIRE_SEED.length} articles`);
}

// ─────────────────────────────────────────────────────────────
// API ROUTES — Health
// ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    status:    'ok',
    db:        mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────
// API ROUTES — AppState (tracker boards, unchanged from v4)
// ─────────────────────────────────────────────────────────────
app.get('/api/state', async (_req, res) => {
  try {
    const doc = await getStateDoc();
    res.json(doc.data || {});
  } catch (err) {
    console.error('[load]', err);
    res.status(500).json({ error: err.message });
  }
});

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
// API ROUTES — Opportunity Wire (separate collection, read-mostly)
// ─────────────────────────────────────────────────────────────

// GET all wire articles, newest-updated first
app.get('/api/opportunities/wire', async (_req, res) => {
  try {
    const articles = await WireArticle.find({}).sort({ updatedAt: -1 }).lean();
    // shape to what the frontend expects (id instead of _id)
    const shaped = articles.map(a => ({
      id: a._id.toString(),
      category: a.category,
      title: a.title,
      blurb: a.blurb,
      deadline: a.deadline,
      url: a.url,
      source: a.source,
    }));
    res.json(shaped);
  } catch (err) {
    console.error('[wire:get]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST a fresh batch — wipes the collection and re-inserts.
// Body: { articles: [ { category, title, blurb, deadline, url, source }, ... ] }
// Use this whenever you (or Claude, on request) hand you an updated
// research batch and want it to replace the current wire.
app.post('/api/opportunities/wire/seed', async (req, res) => {
  try {
    const { articles } = req.body || {};
    if (!Array.isArray(articles) || !articles.length) {
      return res.status(400).json({ error: 'Expected { articles: [...] } with at least one item.' });
    }
    await WireArticle.deleteMany({});
    await WireArticle.insertMany(articles);
    res.json({ ok: true, count: articles.length });
  } catch (err) {
    console.error('[wire:seed]', err);
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
  .then(async () => {
    console.log('✅  MongoDB connected');
    const wireCount = await WireArticle.countDocuments();
    if (wireCount === 0) {
      await reseedWire();
    } else {
      console.log(`🗞️   Opportunity Wire already has ${wireCount} articles — skipping auto-seed`);
    }
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