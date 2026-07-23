const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET;
const IS_STAGING = process.env.USERNODE_ENV === 'staging';

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
const PUBLIC_API_PATHS = new Set(['/health']);
// Public API namespace for account-less page viewing (routes under
// /api/public/ arrive with the public-viewing phase). Parameterized paths
// can't live in the exact-match set above, so prefixes are matched with
// startsWith.
const PUBLIC_PREFIXES = ['/api/public/'];

app.use(express.json({ limit: '2mb' }));

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_SECRET) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch {}
  }

  // Static assets (CSS/JS/images) are always served; the API and the HTML
  // shell are gated so direct hits to the staging/prod subdomain don't
  // leak app data to the public internet.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (PUBLIC_PREFIXES.some((p) => req.path.startsWith(p))) return next();
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const SUBJECT_TYPES = new Set(['self', 'friend', 'pet', 'oc', 'character']);
const SLUG_RE = /^[a-z0-9-]{3,30}$/;
// Path segments the server owns (or will own in later phases) — a page
// handle must never shadow them.
const RESERVED_SLUGS = new Set([
  'api', 'assets', 'audio', 'claim', 'css', 'directory', 'edit', 'health',
  'js', 'make', 'new', 'p', 'page', 'pages', 'staging', 'admin',
]);

function cleanTitle(t) {
  if (typeof t !== 'string') return null;
  const s = t.trim().slice(0, 120);
  return s.length ? s : null;
}

function cleanSubjectName(n) {
  if (typeof n !== 'string') return null;
  const s = n.trim().slice(0, 120);
  return s.length ? s : null;
}

// Structural clamp on the page document. Rendering safety (no innerHTML of
// user strings, color/font whitelists) lives in the shared renderer; the
// server only bounds shape and size so a hostile payload can't bloat rows.
function cleanContent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let str;
  try { str = JSON.stringify(raw); } catch { return null; }
  if (str.length > 400000) return null;
  if (!Array.isArray(raw.sections) || raw.sections.length < 1 || raw.sections.length > 40) return null;
  for (const s of raw.sections) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    if (!Array.isArray(s.blocks) || s.blocks.length > 80) return null;
  }
  return raw;
}

// Default document for a brand-new page: one soft section with the title
// dropped in as an editable text block.
function defaultContent(title) {
  return {
    version: 1,
    cursor: null,
    song: null,
    footerStyle: null,
    sections: [{
      id: 's-' + Math.random().toString(36).slice(2, 8),
      minHeight: 480,
      background: { type: 'gradient', from: '#FDF3F9', to: '#EFE7FB', angle: 160 },
      blocks: [{
        id: 'b-' + Math.random().toString(36).slice(2, 8),
        type: 'text', x: 8, y: 56, w: 84, rotation: -2, z: 1,
        props: { text: title, font: 'fraunces', size: 34, color: '#1F2B47', bold: true, align: 'left', style: 'none' },
      }],
    }],
  };
}

// Loads a page the requesting user owns (owner or co_owner). Sends the
// error response itself and returns null when the caller should bail.
async function loadOwnedPage(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: 'Bad page id' });
    return null;
  }
  const { rows } = await pool.query(
    `SELECT p.*, po.role
     FROM pages p JOIN page_owners po ON po.page_id = p.id
     WHERE p.id = $1 AND po.user_id = $2`,
    [id, req.user.id]
  );
  if (!rows.length) {
    res.status(404).json({ error: 'Page not found' });
    return null;
  }
  return rows[0];
}

// ---------------------------------------------------------------------------
// Authenticated API
// ---------------------------------------------------------------------------

// Home-screen summary: my pages with visit totals + pending guestbook signs.
app.get('/api/me/pages', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.slug, p.title, p.subject_type, p.subject_name, p.published,
              p.directory_listed, p.created_at, p.updated_at, po.role,
              COALESCE(v.total, 0)::bigint AS visits,
              (SELECT COUNT(*) FROM guestbook_entries g
                WHERE g.page_id = p.id AND g.status = 'pending')::int AS pending_signs
       FROM pages p
       JOIN page_owners po ON po.page_id = p.id AND po.user_id = $1
       LEFT JOIN page_visits v ON v.page_id = p.id
       ORDER BY p.updated_at DESC`,
      [req.user.id]
    );
    res.json({ pages: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a page from the five-door chooser.
app.post('/api/pages', async (req, res) => {
  const title = cleanTitle(req.body.title);
  const subjectType = req.body.subject_type;
  const subjectName = cleanSubjectName(req.body.subject_name);
  if (!title) return res.status(400).json({ error: 'A title is required' });
  if (!SUBJECT_TYPES.has(subjectType)) return res.status(400).json({ error: 'Bad subject type' });

  // Pages about someone you know carry a "made by X for Y" byline by default.
  const madeFor = (subjectType === 'friend' || subjectType === 'pet') ? subjectName : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO pages (title, subject_type, subject_name, made_by_username, made_for_name, content)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, subjectType, subjectName, req.user.username, madeFor, JSON.stringify(defaultContent(title))]
    );
    await client.query(
      `INSERT INTO page_owners (page_id, user_id, username, role) VALUES ($1, $2, $3, 'owner')`,
      [rows[0].id, req.user.id, req.user.username]
    );
    await client.query('COMMIT');
    res.json({ page: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/pages/:id', async (req, res) => {
  try {
    const page = await loadOwnedPage(req, res);
    if (!page) return;
    res.json({ page });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save from the editor: title / subject name / content / directory listing.
app.put('/api/pages/:id', async (req, res) => {
  try {
    const page = await loadOwnedPage(req, res);
    if (!page) return;

    const updates = [];
    const values = [];
    if (req.body.title !== undefined) {
      const t = cleanTitle(req.body.title);
      if (!t) return res.status(400).json({ error: 'A title is required' });
      values.push(t); updates.push(`title = $${values.length}`);
    }
    if (req.body.subject_name !== undefined) {
      values.push(cleanSubjectName(req.body.subject_name)); updates.push(`subject_name = $${values.length}`);
    }
    if (req.body.content !== undefined) {
      const c = cleanContent(req.body.content);
      if (!c) return res.status(400).json({ error: 'Bad page content' });
      values.push(JSON.stringify(c)); updates.push(`content = $${values.length}`);
    }
    if (req.body.directory_listed !== undefined) {
      values.push(!!req.body.directory_listed); updates.push(`directory_listed = $${values.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

    values.push(page.id);
    const { rows } = await pool.query(
      `UPDATE pages SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );
    res.json({ page: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Publish (or re-publish under a new handle). Slug is the shareable URL
// segment: /p/<slug> (public viewing route lands in the next phase).
app.post('/api/pages/:id/publish', async (req, res) => {
  try {
    const page = await loadOwnedPage(req, res);
    if (!page) return;
    const slug = typeof req.body.slug === 'string' ? req.body.slug.trim().toLowerCase() : '';
    if (!SLUG_RE.test(slug)) {
      return res.status(400).json({ error: 'Handles are 3–30 characters: lowercase letters, numbers, dashes' });
    }
    if (RESERVED_SLUGS.has(slug)) {
      return res.status(400).json({ error: 'That handle is reserved — try another' });
    }
    const { rows } = await pool.query(
      `UPDATE pages SET slug = $1, published = TRUE, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [slug, page.id]
    );
    res.json({ page: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That handle is taken — try another' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/pages/:id', async (req, res) => {
  try {
    const page = await loadOwnedPage(req, res);
    if (!page) return;
    if (page.role !== 'owner') return res.status(403).json({ error: 'Only the owner can delete a page' });
    await pool.query(`DELETE FROM pages WHERE id = $1`, [page.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated. Unauthenticated top-level
// visits (share links pasted into a browser — Sec-Fetch-Dest: document)
// are sent to the platform's chromeless view of this app, where the shell
// embeds it with a real token so the link just works. Every other
// tokenless case (iframe loads with an expired token, old browsers
// without Sec-Fetch-*) gets the "open in Usernode" landing page instead
// of a redirect, so the platform shell is never loaded INSIDE its own
// app iframe and stray visits still don't reveal the app.
app.get('*', (req, res) => {
  if (!req.user) {
    if (req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, 'https://social-vibecoding.usernodelabs.org/#app/mypage-777ed2/full');
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Usernode</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Usernode</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="https://social-vibecoding.usernodelabs.org/#app/mypage-777ed2/full" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Usernode</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Schema bootstrap (idempotent) + seeds
// ---------------------------------------------------------------------------

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pages (
      id SERIAL PRIMARY KEY,
      slug VARCHAR(64) UNIQUE,
      title VARCHAR(120) NOT NULL,
      subject_type VARCHAR(16) NOT NULL,
      subject_name VARCHAR(120),
      made_by_username VARCHAR(255),
      made_for_name VARCHAR(120),
      content JSONB NOT NULL DEFAULT '{}',
      published BOOLEAN NOT NULL DEFAULT FALSE,
      directory_listed BOOLEAN NOT NULL DEFAULT TRUE,
      directory_delisted_by_report BOOLEAN NOT NULL DEFAULT FALSE,
      footer_style JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS page_owners (
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL,
      username VARCHAR(255) NOT NULL,
      role VARCHAR(16) NOT NULL DEFAULT 'owner',
      PRIMARY KEY (page_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS guestbook_entries (
      id SERIAL PRIMARY KEY,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      author_user_id INTEGER,
      author_name VARCHAR(80) NOT NULL,
      body VARCHAR(280) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_guestbook_page ON guestbook_entries(page_id, status);

    CREATE TABLE IF NOT EXISTS page_visits (
      page_id INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
      total BIGINT NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS gift_claims (
      id SERIAL PRIMARY KEY,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      token VARCHAR(64) UNIQUE NOT NULL,
      created_by VARCHAR(255) NOT NULL,
      recipient_hint VARCHAR(120),
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      claimed_by VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    COMMENT ON TABLE gift_claims IS 'staging:private';

    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      page_id INTEGER REFERENCES pages(id) ON DELETE CASCADE,
      guestbook_entry_id INTEGER,
      reason VARCHAR(32) NOT NULL,
      detail VARCHAR(1000),
      reporter VARCHAR(255) NOT NULL DEFAULT 'anonymous',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    COMMENT ON TABLE reports IS 'staging:private';

    CREATE TABLE IF NOT EXISTS assets (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER NOT NULL,
      kind VARCHAR(16) NOT NULL,
      mime VARCHAR(80) NOT NULL,
      bytes BYTEA NOT NULL,
      size INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS vibe_templates (
      id SERIAL PRIMARY KEY,
      key VARCHAR(40) UNIQUE NOT NULL,
      name VARCHAR(80) NOT NULL,
      description VARCHAR(200),
      content JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sticker_packs (
      id SERIAL PRIMARY KEY,
      key VARCHAR(40) UNIQUE NOT NULL,
      name VARCHAR(80) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stickers (
      id SERIAL PRIMARY KEY,
      pack_id INTEGER NOT NULL REFERENCES sticker_packs(id) ON DELETE CASCADE,
      key VARCHAR(60) UNIQUE NOT NULL,
      svg TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cursor_presets (
      id SERIAL PRIMARY KEY,
      key VARCHAR(40) UNIQUE NOT NULL,
      name VARCHAR(80) NOT NULL,
      config JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS music_library (
      id SERIAL PRIMARY KEY,
      key VARCHAR(40) UNIQUE NOT NULL,
      title VARCHAR(120) NOT NULL,
      artist VARCHAR(120) NOT NULL,
      file_path VARCHAR(200) NOT NULL,
      style VARCHAR(40)
    );
  `);
}

// Small builders for seeded page documents.
function seedSection(id, background, minHeight, blocks) {
  return { id, background, minHeight, blocks };
}
function seedText(id, x, y, w, rotation, z, props) {
  return {
    id, type: 'text', x, y, w, rotation, z,
    props: Object.assign(
      { text: '', font: 'inter', size: 20, color: '#1F2B47', bold: false, align: 'left', style: 'none' },
      props
    ),
  };
}

const SEED_DOCS = {
  corner: {
    version: 1, cursor: null, song: null, footerStyle: null,
    sections: [
      seedSection('s1', { type: 'gradient', from: '#2A1F3D', to: '#4A2B62', angle: 160 }, 520, [
        seedText('b1', 6, 48, 88, -3, 2, { text: '☆ staging demo corner ☆', font: 'fraunces', size: 38, color: '#FFD9F2', bold: true, style: 'sparkle' }),
        seedText('b2', 10, 170, 70, 2, 1, { text: 'a little homemade world — no algorithm, no follower counts, nothing to optimize.', font: 'hand', size: 26, color: '#E8DCFF' }),
        seedText('b3', 18, 330, 60, -6, 3, { text: '~ under construction forever ~', font: 'pixel', size: 13, color: '#9FE8D2' }),
      ]),
      seedSection('s2', { type: 'pattern', pattern: 'dots', color: '#FAF6EE', ink: '#E7DFCC' }, 420, [
        seedText('b4', 8, 40, 80, 0, 1, { text: 'hoarded things', font: 'fraunces', size: 26, color: '#1F2B47', bold: true }),
        seedText('b5', 12, 110, 72, -1, 2, { text: '“Tell me, what is it you plan to do\nwith your one wild and precious life?”\n— Mary Oliver', font: 'typewriter', size: 17, color: '#5A6378' }),
      ]),
    ],
  },
  biscuit: {
    version: 1, cursor: null, song: null, footerStyle: null,
    sections: [
      seedSection('s1', { type: 'gradient', from: '#FDF6EC', to: '#F7DFC8', angle: 145 }, 500, [
        seedText('b1', 8, 44, 84, -2, 2, { text: 'Biscuit 🐾', font: 'fraunces', size: 42, color: '#8A5A2B', bold: true, style: 'shadow' }),
        seedText('b2', 10, 160, 74, 1, 1, { text: 'good dog. best dog. professional napper, amateur squirrel critic.', font: 'comic', size: 22, color: '#6B4B22' }),
        seedText('b3', 20, 320, 56, -5, 3, { text: 'treats accepted here →', font: 'hand', size: 24, color: '#B03A7C' }),
      ]),
    ],
  },
  vex: {
    version: 1, cursor: null, song: null, footerStyle: null,
    sections: [
      seedSection('s1', { type: 'pattern', pattern: 'grid', color: '#101418', ink: '#233041' }, 520, [
        seedText('b1', 6, 50, 88, 0, 2, { text: 'VEX // original character', font: 'pixel', size: 20, color: '#7CFCD0' }),
        seedText('b2', 8, 150, 80, 0, 1, { text: 'age: unknowable\nalignment: chaotic cozy\nweapon: a very long scarf', font: 'typewriter', size: 16, color: '#9DB4CC' }),
        seedText('b3', 14, 330, 70, -3, 3, { text: 'do not perceive them before noon', font: 'inter', size: 18, color: '#E4EDF7', bold: true, style: 'outline' }),
      ]),
    ],
  },
  darcy: {
    version: 1, cursor: null, song: null, footerStyle: null,
    sections: [
      seedSection('s1', { type: 'gradient', from: '#F3EDDF', to: '#DCE7E2', angle: 175 }, 520, [
        seedText('b1', 8, 46, 84, -1, 2, { text: 'Mr. Darcy — a shrine', font: 'fraunces', size: 34, color: '#1F2B47', bold: true }),
        seedText('b2', 10, 150, 76, 1, 1, { text: '“In vain have I struggled. It will not do. My feelings will not be repressed.”', font: 'hand', size: 27, color: '#6B4E9E' }),
        seedText('b3', 16, 320, 64, -2, 3, { text: 'public domain since forever · fan work, no affiliation', font: 'inter', size: 13, color: '#5A6378' }),
      ]),
    ],
  },
  draft: {
    version: 1, cursor: null, song: null, footerStyle: null,
    sections: [
      seedSection('s1', { type: 'solid', color: '#FAF6EE' }, 480, [
        seedText('b1', 8, 60, 80, 0, 1, { text: 'Staging demo draft — still decorating…', font: 'fraunces', size: 28, color: '#1F2B47', bold: true }),
      ]),
    ],
  },
};

// Staging-only demo rows so the My Pages / editor / (future) directory
// screens demo realistically against a fresh staging DB. Idempotent via
// fixed high ids + ON CONFLICT DO NOTHING; strictly a no-op in production.
async function seedStaging() {
  const DEMO_USER_ID = 900001;
  const DEMO_USERNAME = 'staging-demo-user';
  const pages = [
    { id: 900001, slug: 'staging-demo-corner', title: 'staging demo corner', type: 'self', name: DEMO_USERNAME, madeFor: null, doc: SEED_DOCS.corner, published: true },
    { id: 900002, slug: 'staging-biscuit-the-dog', title: 'Biscuit 🐾', type: 'pet', name: 'Biscuit', madeFor: 'Biscuit', doc: SEED_DOCS.biscuit, published: true },
    { id: 900003, slug: 'staging-vex-the-oc', title: 'Vex (OC)', type: 'oc', name: 'Vex', madeFor: null, doc: SEED_DOCS.vex, published: true },
    { id: 900004, slug: 'staging-mr-darcy', title: 'Mr. Darcy shrine', type: 'character', name: 'Mr. Darcy', madeFor: null, doc: SEED_DOCS.darcy, published: true },
    { id: 900005, slug: null, title: 'Staging demo draft', type: 'self', name: DEMO_USERNAME, madeFor: null, doc: SEED_DOCS.draft, published: false },
  ];
  for (const p of pages) {
    await pool.query(
      `INSERT INTO pages (id, slug, title, subject_type, subject_name, made_by_username, made_for_name, content, published)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO NOTHING`,
      [p.id, p.slug, p.title, p.type, p.name, DEMO_USERNAME, p.madeFor, JSON.stringify(p.doc), p.published]
    );
    await pool.query(
      `INSERT INTO page_owners (page_id, user_id, username, role)
       VALUES ($1, $2, $3, 'owner') ON CONFLICT DO NOTHING`,
      [p.id, DEMO_USER_ID, DEMO_USERNAME]
    );
  }
  await pool.query(
    `INSERT INTO page_visits (page_id, total) VALUES (900001, 214), (900002, 88), (900003, 41), (900004, 129)
     ON CONFLICT (page_id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO guestbook_entries (id, page_id, author_user_id, author_name, body, status)
     VALUES
       (900001, 900001, NULL, 'staging-demo-friend', 'kip was here 💜', 'approved'),
       (900002, 900001, NULL, 'staging-demo-visitor', 'love the sparkles!! teach me', 'approved'),
       (900003, 900001, NULL, 'staging-demo-anon', 'first!! (please approve me)', 'pending')
     ON CONFLICT (id) DO NOTHING`
  );
}

async function start() {
  await migrate();
  if (IS_STAGING) await seedStaging();
  app.listen(port, () => console.log(`Listening on :${port}`));
}

start().catch(err => { console.error(err); process.exit(1); });
