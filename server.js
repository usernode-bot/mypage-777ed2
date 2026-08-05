const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const CATALOG = require('./lib/catalog');

const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const USERNODE_JWT_PUBLIC_KEY = process.env.USERNODE_JWT_PUBLIC_KEY;
const IS_STAGING = process.env.USERNODE_ENV === 'staging';

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
const PUBLIC_API_PATHS = new Set(['/health']);
// Public API namespace for account-less page viewing. Parameterized paths
// can't live in the exact-match set above, so prefixes are matched with
// startsWith. Everything under /api/public/ is deliberately account-less:
// pages are the platform's most public artifact.
const PUBLIC_PREFIXES = ['/api/public/'];

// Uploads arrive as base64 JSON (audio ≤5MB → ~6.7MB encoded).
app.use(express.json({ limit: '8mb' }));

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && USERNODE_JWT_PUBLIC_KEY) {
    try {
      const payload = jwt.verify(token, USERNODE_JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: 'usernode:app:' + process.env.USERNODE_APP_ID,
      });
      if (payload.pur === 'iframe') req.user = payload;
    } catch {}
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

app.get('/health', (_req, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'shutting down' });
  res.json({ status: 'ok' });
});

// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico doesn't fall through to the auth-gated catch-all and
// surface a 401 in the console on every fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const SUBJECT_TYPES = new Set(['self', 'friend', 'pet', 'oc', 'character']);
const SLUG_RE = /^[a-z0-9-]{3,30}$/;
// Path segments the server owns — a page handle must never shadow them.
const RESERVED_SLUGS = new Set([
  'api', 'assets', 'audio', 'claim', 'css', 'directory', 'edit', 'health',
  'js', 'make', 'new', 'p', 'page', 'pages', 'staging', 'admin',
  'templates', 'discover', 'home',
]);
const REPORT_REASONS = new Set(['impersonation', 'i_am_the_subject', 'other']);

function cleanTitle(t) {
  if (typeof t !== 'string') return null;
  const v = t.trim().slice(0, 120);
  return v.length ? v : null;
}

function cleanSubjectName(n) {
  if (typeof n !== 'string') return null;
  const v = n.trim().slice(0, 120);
  return v.length ? v : null;
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

function cleanFooterStyle(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const hex = /^#[0-9a-fA-F]{3,8}$/;
  const out = {};
  if (typeof raw.bg === 'string' && hex.test(raw.bg)) out.bg = raw.bg;
  if (typeof raw.color === 'string' && hex.test(raw.color)) out.color = raw.color;
  return Object.keys(out).length ? out : null;
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

// Tiny in-memory rate limiter for the anonymous public POSTs (visits,
// guestbook signs, reports). Per-IP sliding hourly window; the guestbook's
// real spam containment is the owner approval queue.
const rateBuckets = new Map();
function rateLimited(kind, req, max) {
  const key = kind + ':' + (req.ip || 'unknown');
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || now - b.start > 3600000) { b = { start: now, count: 0 }; rateBuckets.set(key, b); }
  b.count += 1;
  if (rateBuckets.size > 20000) rateBuckets.clear(); // crude memory cap
  return b.count > max;
}

const publicPageColumns = `p.id, p.slug, p.title, p.subject_type, p.subject_name,
  p.made_by_username, p.made_for_name, p.content, p.footer_style,
  p.guestbook_closed, p.updated_at`;

async function publicPagePayload(pageRow) {
  const [{ rows: gb }, { rows: v }] = await Promise.all([
    pool.query(
      `SELECT id, author_name, body, created_at FROM guestbook_entries
       WHERE page_id = $1 AND status = 'approved' ORDER BY created_at DESC LIMIT 100`,
      [pageRow.id]
    ),
    pool.query(`SELECT total FROM page_visits WHERE page_id = $1`, [pageRow.id]),
  ]);
  return {
    page: {
      slug: pageRow.slug,
      title: pageRow.title,
      subject_type: pageRow.subject_type,
      made_by_username: pageRow.made_by_username,
      made_for_name: pageRow.made_for_name,
      content: pageRow.content,
      footer_style: pageRow.footer_style,
      guestbook_closed: pageRow.guestbook_closed,
    },
    visits: v.length ? Number(v[0].total) : 0,
    guestbook: gb,
  };
}

// ---------------------------------------------------------------------------
// Public API — account-less viewing (spec §6.6/§6.7)
// ---------------------------------------------------------------------------

app.get('/api/public/pages/:slug', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${publicPageColumns} FROM pages p WHERE p.slug = $1 AND p.published = TRUE`,
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ error: 'No page at this handle' });
    res.json(await publicPagePayload(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/public/pages/:slug/visit', async (req, res) => {
  try {
    if (rateLimited('visit', req, 120)) return res.json({ ok: true }); // silently drop
    const { rows } = await pool.query(`SELECT id FROM pages WHERE slug = $1 AND published = TRUE`, [req.params.slug]);
    if (!rows.length) return res.status(404).json({ error: 'No page' });
    const r = await pool.query(
      `INSERT INTO page_visits (page_id, total) VALUES ($1, 1)
       ON CONFLICT (page_id) DO UPDATE SET total = page_visits.total + 1 RETURNING total`,
      [rows[0].id]
    );
    res.json({ ok: true, total: Number(r.rows[0].total) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Guestbook signing: logged-in signs post immediately; anonymous signs go
// to the owner's approval queue (the spec's spam containment). `website`
// is a honeypot — bots that fill it are silently accepted and dropped.
app.post('/api/public/pages/:slug/guestbook', async (req, res) => {
  try {
    if (typeof req.body.website === 'string' && req.body.website.length) return res.json({ ok: true, status: 'pending' });
    if (rateLimited('guestbook', req, 20)) return res.status(429).json({ error: 'Too many signs — try again later' });
    const body = typeof req.body.body === 'string' ? req.body.body.trim().slice(0, 280) : '';
    if (!body) return res.status(400).json({ error: 'Write a little something first' });
    const { rows } = await pool.query(
      `SELECT id, guestbook_closed FROM pages WHERE slug = $1 AND published = TRUE`,
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ error: 'No page' });
    if (rows[0].guestbook_closed) return res.status(403).json({ error: 'This guestbook is closed' });

    let name, userId = null, status;
    if (req.user) {
      name = req.user.username;
      userId = req.user.id;
      status = 'approved';
    } else {
      name = typeof req.body.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
      if (!name) return res.status(400).json({ error: 'Sign with a name' });
      status = 'pending';
    }
    const ins = await pool.query(
      `INSERT INTO guestbook_entries (page_id, author_user_id, author_name, body, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, author_name, body, created_at, status`,
      [rows[0].id, userId, name, body, status]
    );
    res.json({ ok: true, status, entry: ins.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Discover (the directory): a gallery to wander, not a feed. Recency or
// shuffle, filtered by subject, searchable by title/creator, honoring
// per-page opt-out and report delisting.
app.get('/api/public/directory', async (req, res) => {
  try {
    const subject = SUBJECT_TYPES.has(req.query.subject) ? req.query.subject : null;
    const order = req.query.order === 'shuffle' ? 'RANDOM()' : 'p.updated_at DESC';
    const params = [];
    let where = `p.published = TRUE AND p.directory_listed = TRUE AND p.directory_delisted_by_report = FALSE`;
    if (subject) { params.push(subject); where += ` AND p.subject_type = $${params.length}`; }
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
    if (q) {
      params.push('%' + q.replace(/[%_\\]/g, '\\$&') + '%');
      where += ` AND (p.title ILIKE $${params.length} OR p.made_by_username ILIKE $${params.length})`;
    }
    const { rows } = await pool.query(
      `SELECT p.slug, p.title, p.subject_type, p.made_by_username, p.made_for_name,
              p.content->'sections'->0 AS first_section, p.updated_at,
              COALESCE(v.total, 0)::bigint AS visits
       FROM pages p LEFT JOIN page_visits v ON v.page_id = p.id
       WHERE ${where} ORDER BY ${order} LIMIT 60`,
      params
    );
    res.json({ pages: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The full product catalog (templates, stickers, cursors, music) — public
// so the account-less /make editor gets the same toolkit.
app.get('/api/public/catalog', async (_req, res) => {
  try {
    const [templates, packs, stickers, cursors, music] = await Promise.all([
      pool.query(`SELECT key, name, description, content, featured, subject_type, tagline, steps
                  FROM vibe_templates ORDER BY featured DESC, id`),
      pool.query(`SELECT id, key, name FROM sticker_packs ORDER BY id`),
      pool.query(`SELECT pack_id, key, svg FROM stickers ORDER BY id`),
      pool.query(`SELECT key, name, config FROM cursor_presets ORDER BY id`),
      pool.query(`SELECT key, title, artist, file_path, style FROM music_library ORDER BY id`),
    ]);
    const packList = packs.rows.map((p) => ({
      key: p.key, name: p.name,
      stickers: stickers.rows.filter((st) => st.pack_id === p.id).map((st) => ({ key: st.key, svg: st.svg })),
    }));
    res.json({
      templates: templates.rows,
      stickerPacks: packList,
      cursors: cursors.rows,
      music: music.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Gift claim preview: the token is the bearer credential, so it may show
// the page even before publish (a gift is often sent pre-publish).
app.get('/api/public/claims/:token', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.status, g.created_by, g.recipient_hint, ${publicPageColumns}
       FROM gift_claims g JOIN pages p ON p.id = g.page_id WHERE g.token = $1`,
      [req.params.token]
    );
    if (!rows.length) return res.status(404).json({ error: 'This gift link isn’t valid' });
    const row = rows[0];
    const payload = await publicPagePayload(row);
    payload.gift = { status: row.status, created_by: row.created_by, recipient_hint: row.recipient_hint };
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reports: impersonation is banned; a report from the page's subject
// immediately delists the page from the directory (subject's wish wins) —
// full takedown stays a governance action.
app.post('/api/public/reports', async (req, res) => {
  try {
    if (rateLimited('report', req, 10)) return res.status(429).json({ error: 'Too many reports — try again later' });
    const reason = REPORT_REASONS.has(req.body.reason) ? req.body.reason : null;
    if (!reason) return res.status(400).json({ error: 'Pick a reason' });
    const slug = typeof req.body.slug === 'string' ? req.body.slug : '';
    const { rows } = await pool.query(`SELECT id FROM pages WHERE slug = $1`, [slug]);
    if (!rows.length) return res.status(404).json({ error: 'No page' });
    const entryId = Number.isInteger(req.body.entry_id) ? req.body.entry_id : null;
    const detail = typeof req.body.detail === 'string' ? req.body.detail.trim().slice(0, 1000) : null;
    await pool.query(
      `INSERT INTO reports (page_id, guestbook_entry_id, reason, detail, reporter) VALUES ($1, $2, $3, $4, $5)`,
      [rows[0].id, entryId, reason, detail, req.user ? req.user.username : 'anonymous']
    );
    if (reason === 'i_am_the_subject') {
      await pool.query(`UPDATE pages SET directory_delisted_by_report = TRUE WHERE id = $1`, [rows[0].id]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Authenticated API
// ---------------------------------------------------------------------------

// Home-screen summary: my pages with visit totals + pending guestbook signs.
app.get('/api/me/pages', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.slug, p.title, p.subject_type, p.subject_name, p.published,
              p.directory_listed, p.directory_delisted_by_report, p.created_at, p.updated_at, po.role,
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

// Gift pages waiting for me (matched on the giver's recipient hint —
// the claim link itself works for anyone it was sent to).
app.get('/api/me/gifts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.token, g.created_by, g.created_at, p.title, p.subject_type
       FROM gift_claims g JOIN pages p ON p.id = g.page_id
       WHERE g.status = 'pending' AND LOWER(g.recipient_hint) = LOWER($1)
       ORDER BY g.created_at DESC`,
      [req.user.username]
    );
    res.json({ gifts: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a page from the five-door chooser (optionally from a template or
// an imported local draft's content).
app.post('/api/pages', async (req, res) => {
  const title = cleanTitle(req.body.title);
  const subjectType = req.body.subject_type;
  const subjectName = cleanSubjectName(req.body.subject_name);
  if (!title) return res.status(400).json({ error: 'A title is required' });
  if (!SUBJECT_TYPES.has(subjectType)) return res.status(400).json({ error: 'Bad subject type' });

  let content = null;
  if (req.body.content !== undefined) {
    content = cleanContent(req.body.content);
    if (!content) return res.status(400).json({ error: 'Bad page content' });
  } else if (typeof req.body.template === 'string') {
    const { rows } = await pool.query(`SELECT content FROM vibe_templates WHERE key = $1`, [req.body.template]);
    if (rows.length) content = rows[0].content;
  }
  if (!content) content = defaultContent(title);

  // Pages about someone you know carry a "made by X for Y" byline by default.
  const madeFor = (subjectType === 'friend' || subjectType === 'pet') ? subjectName : null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO pages (title, subject_type, subject_name, made_by_username, made_for_name, content)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, subjectType, subjectName, req.user.username, madeFor, JSON.stringify(content)]
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

// Save from the editor: title / subject name / content / listing / book.
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
    if (req.body.footer_style !== undefined) {
      values.push(JSON.stringify(cleanFooterStyle(req.body.footer_style))); updates.push(`footer_style = $${values.length}`);
    }
    if (req.body.directory_listed !== undefined) {
      values.push(!!req.body.directory_listed); updates.push(`directory_listed = $${values.length}`);
    }
    if (req.body.guestbook_closed !== undefined) {
      values.push(!!req.body.guestbook_closed); updates.push(`guestbook_closed = $${values.length}`);
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
// segment: /p/<slug> — account-less for every visitor.
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

// -------------------------------------------------------------- uploads

const UPLOAD_RULES = {
  image: { mimes: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']), max: 2 * 1024 * 1024 },
  audio: { mimes: new Set(['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/aac']), max: 5 * 1024 * 1024 },
};
const USER_QUOTA = 25 * 1024 * 1024;

app.post('/api/uploads', async (req, res) => {
  try {
    const kind = req.body.kind;
    const rule = UPLOAD_RULES[kind];
    if (!rule) return res.status(400).json({ error: 'Bad upload kind' });
    const mime = typeof req.body.mime === 'string' ? req.body.mime.toLowerCase() : '';
    if (!rule.mimes.has(mime)) return res.status(400).json({ error: 'Unsupported file type' });
    if (typeof req.body.data !== 'string') return res.status(400).json({ error: 'Missing data' });
    let bytes;
    try { bytes = Buffer.from(req.body.data, 'base64'); } catch { return res.status(400).json({ error: 'Bad data' }); }
    if (!bytes.length || bytes.length > rule.max) {
      return res.status(400).json({ error: `Too big — ${kind}s are capped at ${Math.round(rule.max / 1024 / 1024)}MB` });
    }
    const { rows: q } = await pool.query(
      `SELECT COALESCE(SUM(size), 0)::bigint AS used FROM assets WHERE owner_user_id = $1`, [req.user.id]
    );
    if (Number(q[0].used) + bytes.length > USER_QUOTA) {
      return res.status(400).json({ error: 'Upload space is full (25MB per person) — delete something first' });
    }
    const { rows } = await pool.query(
      `INSERT INTO assets (owner_user_id, kind, mime, bytes, size) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.user.id, kind, mime, bytes, bytes.length]
    );
    res.json({ id: rows[0].id, url: '/assets/' + rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------- guestbook moderation (owner)

app.get('/api/pages/:id/guestbook', async (req, res) => {
  try {
    const page = await loadOwnedPage(req, res);
    if (!page) return;
    const { rows } = await pool.query(
      `SELECT id, author_name, body, status, created_at FROM guestbook_entries
       WHERE page_id = $1 ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 300`,
      [page.id]
    );
    res.json({ entries: rows, guestbook_closed: page.guestbook_closed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pages/:id/guestbook/:entryId/approve', async (req, res) => {
  try {
    const page = await loadOwnedPage(req, res);
    if (!page) return;
    await pool.query(
      `UPDATE guestbook_entries SET status = 'approved' WHERE id = $1 AND page_id = $2`,
      [parseInt(req.params.entryId, 10) || 0, page.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/pages/:id/guestbook/:entryId', async (req, res) => {
  try {
    const page = await loadOwnedPage(req, res);
    if (!page) return;
    await pool.query(
      `DELETE FROM guestbook_entries WHERE id = $1 AND page_id = $2`,
      [parseInt(req.params.entryId, 10) || 0, page.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------- gifts & claims

app.post('/api/pages/:id/gift', async (req, res) => {
  try {
    const page = await loadOwnedPage(req, res);
    if (!page) return;
    const hint = cleanSubjectName(req.body.recipient_hint);
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO gift_claims (page_id, token, created_by, recipient_hint) VALUES ($1, $2, $3, $4)`,
      [page.id, token, req.user.username, hint]
    );
    res.json({ token, url: '/claim/' + token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Claiming a gift: co-own keeps the giver as owner and adds you; take-over
// makes you the owner and demotes everyone else to co_owner.
app.post('/api/claims/:token/claim', async (req, res) => {
  const mode = req.body.mode === 'take_over' ? 'take_over' : 'co_own';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM gift_claims WHERE token = $1 FOR UPDATE`, [req.params.token]
    );
    if (!rows.length || rows[0].status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(rows.length ? 409 : 404).json({ error: rows.length ? 'This gift was already claimed' : 'This gift link isn’t valid' });
    }
    const gift = rows[0];
    if (mode === 'take_over') {
      await client.query(`UPDATE page_owners SET role = 'co_owner' WHERE page_id = $1`, [gift.page_id]);
    }
    await client.query(
      `INSERT INTO page_owners (page_id, user_id, username, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (page_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [gift.page_id, req.user.id, req.user.username, mode === 'take_over' ? 'owner' : 'co_owner']
    );
    await client.query(
      `UPDATE gift_claims SET status = 'claimed', claimed_by = $1 WHERE id = $2`,
      [req.user.username, gift.id]
    );
    await client.query('COMMIT');
    res.json({ ok: true, page_id: gift.page_id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// Public HTML routes — registered BEFORE the auth-gated catch-all so shared
// links serve content directly (spec §6.7: no login to view or browse).
// ---------------------------------------------------------------------------

app.get('/assets/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).end();
    const { rows } = await pool.query(`SELECT mime, bytes FROM assets WHERE id = $1`, [id]);
    if (!rows.length) return res.status(404).end();
    res.set('Content-Type', rows[0].mime);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(rows[0].bytes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const VIEW_HTML = path.join(__dirname, 'public', 'view.html');
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');

app.get('/p/:slug', (_req, res) => res.sendFile(VIEW_HTML));
app.get('/claim/:token', (_req, res) => res.sendFile(VIEW_HTML));
// The account-less editor and the directory are public shells: their data
// comes only from /api/public/* (or localStorage) until the user signs in.
app.get('/make', (_req, res) => res.sendFile(INDEX_HTML));
app.get('/directory', (_req, res) => res.sendFile(INDEX_HTML));
app.get('/discover', (_req, res) => res.sendFile(INDEX_HTML));
app.get('/templates', (_req, res) => res.sendFile(INDEX_HTML));
app.get('/pages', (_req, res) => res.sendFile(INDEX_HTML));

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
  res.sendFile(INDEX_HTML);
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
    ALTER TABLE pages ADD COLUMN IF NOT EXISTS guestbook_closed BOOLEAN NOT NULL DEFAULT FALSE;

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
    ALTER TABLE vibe_templates ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE vibe_templates ADD COLUMN IF NOT EXISTS subject_type TEXT;
    ALTER TABLE vibe_templates ADD COLUMN IF NOT EXISTS tagline TEXT;
    ALTER TABLE vibe_templates ADD COLUMN IF NOT EXISTS steps JSONB;

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

// Catalog content ships with the app and seeds in EVERY environment —
// upserted so template/sticker improvements land on redeploy.
async function seedCatalog() {
  for (const t of CATALOG.TEMPLATES) {
    await pool.query(
      `INSERT INTO vibe_templates (key, name, description, content, featured, subject_type, tagline, steps)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
         content = EXCLUDED.content, featured = EXCLUDED.featured, subject_type = EXCLUDED.subject_type,
         tagline = EXCLUDED.tagline, steps = EXCLUDED.steps`,
      [t.key, t.name, t.description, JSON.stringify(t.content), !!t.featured,
       t.subject_type || null, t.tagline || null, t.steps ? JSON.stringify(t.steps) : null]
    );
  }
  for (const pack of CATALOG.STICKER_PACKS) {
    const { rows } = await pool.query(
      `INSERT INTO sticker_packs (key, name) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [pack.key, pack.name]
    );
    for (const st of pack.stickers) {
      await pool.query(
        `INSERT INTO stickers (pack_id, key, svg) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET svg = EXCLUDED.svg, pack_id = EXCLUDED.pack_id`,
        [rows[0].id, st.key, st.svg]
      );
    }
  }
  for (const c of CATALOG.CURSOR_PRESETS) {
    await pool.query(
      `INSERT INTO cursor_presets (key, name, config) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, config = EXCLUDED.config`,
      [c.key, c.name, JSON.stringify(c.config)]
    );
  }
  for (const m of CATALOG.MUSIC_LIBRARY) {
    await pool.query(
      `INSERT INTO music_library (key, title, artist, file_path, style) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, artist = EXCLUDED.artist, file_path = EXCLUDED.file_path, style = EXCLUDED.style`,
      [m.key, m.title, m.artist, m.file_path, m.style]
    );
  }
}

// ------------------------------------------------------- staging seeds

const B = CATALOG.builders;

const SEED_DOCS = {
  corner: B.doc(
    { type: 'preset', key: 'sparkle-wand' },
    { title: 'Starlight Arcade', artist: 'MyPage originals (CC0)', linkUrl: null, source: 'library:starlight-arcade' },
    { bg: '#2A1F3D', color: '#FFD9F2' },
    [
      B.section('s1', { type: 'gradient', from: '#2A1F3D', to: '#4A2B62', angle: 160 }, 560, [
        B.text('b1', 6, 48, 88, -3, 3, { text: '☆ staging demo corner ☆', font: 'fraunces', size: 38, color: '#FFD9F2', bold: true, style: 'sparkle' }),
        B.widget('m1', 4, 170, 92, 0, 2, { kind: 'marquee', text: '♡ welcome to my corner — no algorithm here ♡', speed: 11, color: '#9FE8D2', size: 18 }),
        B.widget('sg1', 8, 240, 84, -1, 3, { kind: 'song' }),
        B.sticker('st1', 74, 400, 18, 12, 4, 'blink-star'),
        { id: 'st-em1', type: 'sticker', x: 8, y: 380, w: 14, rotation: -8, z: 4, props: { emoji: '🌟' } },
        B.widget('w1', 10, 420, 56, 2, 2, { kind: 'mood', mood: '✨', label: 'sparkly' }),
      ]),
      B.section('s2', { type: 'pattern', pattern: 'dots', color: '#FAF6EE', ink: '#E7DFCC' }, 520, [
        B.text('b4', 8, 40, 80, 0, 1, { text: 'hoarded things', font: 'fraunces', size: 26, color: '#1F2B47', bold: true }),
        B.text('b5', 12, 110, 72, -1, 2, { text: '“Tell me, what is it you plan to do\nwith your one wild and precious life?”\n— Mary Oliver', font: 'typewriter', size: 17, color: '#5A6378' }),
        B.widget('w2', 12, 270, 70, 0, 2, { kind: 'counter', style: 'classic' }),
        B.widget('w3', 8, 380, 84, 0, 1, { kind: 'guestbook' }),
      ]),
    ]
  ),
  biscuit: B.doc(
    { type: 'preset', key: 'paw-prints' },
    { title: 'Paw Prints', artist: 'MyPage originals (CC0)', linkUrl: null, source: 'library:paw-prints' },
    { bg: '#F7DFC8', color: '#8A5A2B' },
    [
      B.section('s1', { type: 'gradient', from: '#FDF6EC', to: '#F7DFC8', angle: 145 }, 560, [
        B.text('b1', 8, 44, 84, -2, 2, { text: 'Biscuit 🐾', font: 'fraunces', size: 42, color: '#8A5A2B', bold: true, style: 'shadow' }),
        B.text('b2', 10, 160, 74, 1, 1, { text: 'good dog. best dog. professional napper, amateur squirrel critic.', font: 'comic', size: 22, color: '#6B4B22' }),
        B.sticker('st1', 70, 280, 20, -8, 3, 'stamp-heart'),
        B.widget('sg1', 8, 320, 80, 0, 2, { kind: 'song' }),
        B.widget('w1', 12, 460, 60, -1, 2, { kind: 'mood', mood: '🦴', label: 'snacky' }),
      ]),
      B.section('s2', { type: 'solid', color: '#FFFDF4' }, 420, [
        B.widget('w2', 12, 50, 70, 0, 2, { kind: 'counter', style: 'classic' }),
        B.widget('w3', 8, 170, 84, 0, 1, { kind: 'guestbook' }),
      ]),
    ]
  ),
  vex: B.doc(
    { type: 'preset', key: 'pixel-arrow' }, null, { bg: '#0A0F0A', color: '#7CFCD0' },
    [
      B.section('s1', { type: 'pattern', pattern: 'grid', color: '#101418', ink: '#233041' }, 560, [
        B.text('b1', 6, 50, 88, 0, 2, { text: 'VEX // original character', font: 'pixel', size: 20, color: '#7CFCD0' }),
        B.text('b2', 8, 150, 80, 0, 1, { text: 'age: unknowable\nalignment: chaotic cozy\nweapon: a very long scarf', font: 'typewriter', size: 16, color: '#9DB4CC' }),
        B.text('b3', 14, 320, 70, -3, 3, { text: 'do not perceive them before noon', font: 'inter', size: 18, color: '#E4EDF7', bold: true, style: 'outline' }),
        B.widget('w1', 8, 420, 80, 0, 2, { kind: 'links', links: [{ label: 'art tag', url: 'https://example.com' }, { label: 'lore doc', url: 'https://example.com' }] }),
      ]),
    ]
  ),
  darcy: B.doc(
    { type: 'preset', key: 'hourglass' }, null, { bg: '#F3EDDF', color: '#5A6378' },
    [
      B.section('s1', { type: 'gradient', from: '#F3EDDF', to: '#DCE7E2', angle: 175 }, 560, [
        B.text('b1', 8, 46, 84, -1, 2, { text: 'Mr. Darcy — a shrine', font: 'fraunces', size: 34, color: '#1F2B47', bold: true }),
        B.text('b2', 10, 150, 76, 1, 1, { text: '“In vain have I struggled. It will not do. My feelings will not be repressed.”', font: 'hand', size: 27, color: '#6B4E9E' }),
        B.widget('w1', 14, 300, 60, -1, 2, { kind: 'currently', items: [{ verb: 'rereading', what: 'chapter 34, again' }] }),
        B.text('b3', 16, 460, 64, -2, 3, { text: 'public domain · fan work, no affiliation', font: 'inter', size: 13, color: '#5A6378' }),
      ]),
    ]
  ),
  draft: B.doc(null, null, null, [
    B.section('s1', { type: 'solid', color: '#FAF6EE' }, 480, [
      B.text('b1', 8, 60, 80, 0, 1, { text: 'Staging demo draft — still decorating…', font: 'fraunces', size: 28, color: '#1F2B47', bold: true }),
    ]),
  ]),
  gift: B.doc(
    { type: 'preset', key: 'heart-wand' }, null, { bg: '#FFD9F2', color: '#B03A7C' },
    [
      B.section('s1', { type: 'gradient', from: '#FFD9F2', to: '#FF9DE2', angle: 160 }, 520, [
        B.text('b1', 8, 50, 84, -2, 2, { text: 'for staging-demo-friend 💌', font: 'fraunces', size: 34, color: '#B03A7C', bold: true, style: 'sparkle' }),
        B.text('b2', 10, 170, 74, 1, 1, { text: 'someone made you a page.\nit is yours now, if you want it.', font: 'hand', size: 26, color: '#8A3A6A' }),
        B.sticker('st1', 68, 300, 22, 8, 3, 'blink-heart'),
      ]),
    ]
  ),
};

// Staging-only demo rows so every screen demos realistically against a
// fresh staging DB. Idempotent via fixed high ids + ON CONFLICT DO NOTHING;
// strictly a no-op in production. The gift_claims row must be seeded here:
// the table is staging:private, so staging gets schema only.
const STAGING_GIFT_TOKEN = 'staging-demo-gift-000000000001';

// The flagship starter templates double as staging demo pages, so Home's
// featured rail, the Templates gallery, Discover cards and the new widgets
// (status/quote/list/playlist/album/popup + frames) all render against
// real published rows in every staging preview.
const flagshipDoc = (key) => {
  const t = CATALOG.TEMPLATES.find((x) => x.key === key);
  return t ? t.content : null;
};

async function seedStaging() {
  const DEMO_USER_ID = 900001;
  const DEMO_USERNAME = 'staging-demo-user';
  const pages = [
    { id: 900007, slug: 'staging-scene-demo', title: 'staging demo — scene page', type: 'self', name: DEMO_USERNAME, madeFor: null, doc: flagshipDoc('scene-page'), published: true, footer: { bg: '#5A4A38', color: '#F3E9DC' } },
    { id: 900008, slug: 'staging-bestie-demo', title: 'staging demo — bestie page', type: 'friend', name: 'staging-demo-friend', madeFor: 'staging-demo-friend', doc: flagshipDoc('bestie-page'), published: true, footer: { bg: '#B03A7C', color: '#FFD9F2' } },
    { id: 900009, slug: 'staging-y2k-demo', title: 'staging demo — y2k page', type: 'self', name: DEMO_USERNAME, madeFor: null, doc: flagshipDoc('y2k-page'), published: true, footer: { bg: '#D9DDE3', color: '#31384A' } },
    { id: 900010, slug: 'staging-pet-demo', title: 'staging demo — pet fan page', type: 'pet', name: 'Beans', madeFor: 'Beans', doc: flagshipDoc('pet-fan-page'), published: true, footer: { bg: '#31384A', color: '#DCE9F7' } },
    { id: 900001, slug: 'staging-demo-corner', title: 'staging demo corner', type: 'self', name: DEMO_USERNAME, madeFor: null, doc: SEED_DOCS.corner, published: true, footer: { bg: '#2A1F3D', color: '#FFD9F2' } },
    { id: 900002, slug: 'staging-biscuit-the-dog', title: 'Biscuit 🐾', type: 'pet', name: 'Biscuit', madeFor: 'Biscuit', doc: SEED_DOCS.biscuit, published: true, footer: { bg: '#F7DFC8', color: '#8A5A2B' } },
    { id: 900003, slug: 'staging-vex-the-oc', title: 'Vex (OC)', type: 'oc', name: 'Vex', madeFor: null, doc: SEED_DOCS.vex, published: true, footer: { bg: '#0A0F0A', color: '#7CFCD0' } },
    { id: 900004, slug: 'staging-mr-darcy', title: 'Mr. Darcy shrine', type: 'character', name: 'Mr. Darcy', madeFor: null, doc: SEED_DOCS.darcy, published: true, footer: null },
    { id: 900005, slug: null, title: 'Staging demo draft', type: 'self', name: DEMO_USERNAME, madeFor: null, doc: SEED_DOCS.draft, published: false, footer: null },
    { id: 900006, slug: 'staging-gift-page', title: 'for staging-demo-friend', type: 'friend', name: 'staging-demo-friend', madeFor: 'staging-demo-friend', doc: SEED_DOCS.gift, published: true, footer: { bg: '#FFD9F2', color: '#B03A7C' } },
  ];
  for (const p of pages) {
    await pool.query(
      `INSERT INTO pages (id, slug, title, subject_type, subject_name, made_by_username, made_for_name, content, published, footer_style)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING`,
      [p.id, p.slug, p.title, p.type, p.name, DEMO_USERNAME, p.madeFor, JSON.stringify(p.doc), p.published, p.footer ? JSON.stringify(p.footer) : null]
    );
    await pool.query(
      `INSERT INTO page_owners (page_id, user_id, username, role)
       VALUES ($1, $2, $3, 'owner') ON CONFLICT DO NOTHING`,
      [p.id, DEMO_USER_ID, DEMO_USERNAME]
    );
  }
  await pool.query(
    `INSERT INTO page_visits (page_id, total) VALUES (900001, 214), (900002, 88), (900003, 41), (900004, 129), (900006, 5), (900007, 96), (900009, 163)
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
  await pool.query(
    `INSERT INTO gift_claims (id, page_id, token, created_by, recipient_hint, status)
     VALUES (900001, 900006, $1, 'staging-demo-user', 'staging-demo-friend', 'pending')
     ON CONFLICT (id) DO NOTHING`,
    [STAGING_GIFT_TOKEN]
  );
}

// Graceful shutdown (platform convention): stop accepting connections,
// drain in-flight requests under a hard deadline, close the pool, exit.
const DRAIN_MS = 3000;
let shuttingDown = false;
let server = null;

async function shutdown(signal) {
  if (shuttingDown) return; // idempotent: repeat signals must not double-run
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received, draining`);
  if (server) {
    server.close(() => {});
    server.closeIdleConnections?.();
    const t = setTimeout(() => server.closeAllConnections?.(), DRAIN_MS);
    t.unref?.();
  }
  try {
    await pool.end();
  } catch (e) {
    console.error('[shutdown] pool.end failed', e.message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function start() {
  await migrate();
  await seedCatalog();
  if (IS_STAGING) await seedStaging();
  server = app.listen(port, () => console.log(`Listening on :${port}`));
}

start().catch(err => { console.error(err); process.exit(1); });
