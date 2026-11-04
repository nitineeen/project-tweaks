import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fuzzyScore } from './fuzzy.js';

// NOTE: node:sqlite rows have null prototypes, which Next.js refuses to pass
// to Client Components. Every getter below returns plain objects/arrays only
// (via P/PA) so any page may hand rows to client islands safely.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS saves (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL, user_id TEXT NOT NULL,
  original_url TEXT NOT NULL, canonical_url TEXT, page_title TEXT,
  extracted_text TEXT DEFAULT '', ocr_text TEXT DEFAULT '',
  screenshot_path TEXT, date_saved TEXT, time_saved TEXT, tz TEXT DEFAULT 'UTC',
  user_reason TEXT DEFAULT '', ai_explanation TEXT DEFAULT '',
  classifications TEXT DEFAULT '{}', winners TEXT DEFAULT '{}', top_signals TEXT DEFAULT '[]',
  meta_l1 TEXT, meta_l2 TEXT, meta_l3 TEXT, meta_confidence INTEGER,
  visual_metadata TEXT DEFAULT '{}', folder_slug TEXT, status TEXT DEFAULT 'capturing',
  deleted_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS saves_space_created_idx ON saves(space_id, created_at DESC);
CREATE TABLE IF NOT EXISTS taxonomy_stats (
  space_id TEXT NOT NULL, set_name TEXT NOT NULL, label TEXT NOT NULL,
  shown_as TEXT NOT NULL, saves_count INTEGER DEFAULT 0, is_seed INTEGER DEFAULT 0,
  first_seen_at TEXT, last_seen_at TEXT,
  PRIMARY KEY (space_id, set_name, label)
);
CREATE TABLE IF NOT EXISTS user_memory (
  space_id TEXT NOT NULL, layer TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  confidence INTEGER DEFAULT 80, expires_at TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (space_id, layer, key)
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL,
  intention TEXT DEFAULT '', status TEXT DEFAULT 'active', created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, UNIQUE (space_id, slug)
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL, project_id TEXT, title TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
  content TEXT NOT NULL, cited_save_ids TEXT DEFAULT '[]', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL, project_id TEXT, conversation_id TEXT,
  title TEXT NOT NULL, body TEXT DEFAULT '', linked_save_ids TEXT DEFAULT '[]',
  word_count INTEGER DEFAULT 0, updated_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT DEFAULT '',
  status TEXT DEFAULT 'active', token_limit INTEGER, is_admin INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model_rates (
  model TEXT PRIMARY KEY, per_1m_in REAL, per_1m_out REAL,
  per_unit REAL, unit TEXT, source TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY, space_id TEXT NOT NULL, user_id TEXT NOT NULL,
  kind TEXT NOT NULL, model TEXT NOT NULL,
  in_tokens INTEGER DEFAULT 0, out_tokens INTEGER DEFAULT 0, units REAL DEFAULT 0,
  cost_usd REAL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_user_idx ON usage_events(user_id, created_at DESC);`;

const SAVE_ALTERS = [
  'ALTER TABLE saves ADD COLUMN save_type TEXT DEFAULT \'page\'',
  'ALTER TABLE saves ADD COLUMN project_slug TEXT',
  'ALTER TABLE saves ADD COLUMN is_resource INTEGER DEFAULT 0',
  'ALTER TABLE saves ADD COLUMN resource_kind TEXT',
  'ALTER TABLE saves ADD COLUMN selection TEXT DEFAULT \'\'',
  'ALTER TABLE saves ADD COLUMN image_url TEXT',
];

const EXTRA_ALTERS = [
  'ALTER TABLE messages ADD COLUMN ref_ids TEXT DEFAULT \'[]\'',
  'ALTER TABLE conversations ADD COLUMN share_token TEXT',
];

let db = null;

export function getDb() {
  if (db) return db;
  const p = process.env.SQLITE_PATH || './.local/tweaks.db';
  const abs = path.resolve(process.cwd(), p);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  db = new DatabaseSync(abs);
  db.exec(SCHEMA);
  for (const sql of [...SAVE_ALTERS, ...EXTRA_ALTERS]) {
    try {
      db.exec(sql);
    } catch {
      /* column already exists */
    }
  }
  db.prepare(`INSERT OR IGNORE INTO spaces(id, name) VALUES('local-dev','Local')`).run();
  seedRates(db);
  db.prepare(
    `INSERT OR IGNORE INTO users(id, email, name, status, is_admin, created_at)
     VALUES('local-user','local@tweaks','Local user','active',1,?)`
  ).run(new Date().toISOString());
  return db;
}

// Rates verified on dev.meta.ai/docs/pricing-rate-limits (Nov 2026):
// Spark $1.25/$4.25 per 1M, Contributor $0.10/$0.20, Image $0.01/img,
// Voice $0.18/hr, SAM $2.50/1K imgs. Wonder ($4/$20) not seeded — unused.
// INSERT OR IGNORE: admin edits in /admin are never overwritten.
function seedRates(db) {
  const rows = [
    ['muse-spark-1.3', 1.25, 4.25, null, null, 'meta-pricing-2026-11'],
    ['muse-spark-1.2', 1.25, 4.25, null, null, 'meta-pricing-2026-11'],
    ['muse-spark-1.1', 1.25, 4.25, null, null, 'meta-pricing-2026-11'],
    ['muse-spark-1.3-contributor', 0.1, 0.2, null, null, 'meta-pricing-2026-11'],
    ['muse-spark-1.2-contributor', 0.1, 0.2, null, null, 'meta-pricing-2026-11'],
    ['muse-image-1.0', null, null, 0.01, 'image', 'meta-pricing-2026-11'],
    ['muse-voice-transcribe-1.0', null, null, 0.18, 'hour', 'meta-pricing-2026-11'],
    ['sam-3.1', null, null, 0.0025, 'image', 'meta-pricing-2026-11'],
    ['open-weights-local', 0, 0, null, null, 'local (free)'],
  ];
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO model_rates (model, per_1m_in, per_1m_out, per_unit, unit, source)
     VALUES (?,?,?,?,?,?)`
  );
  for (const r of rows) stmt.run(...r);
}

function safeParse(s, fb) {
  try {
    return JSON.parse(s);
  } catch {
    return fb;
  }
}

/** Plain-object copies: null-prototype sqlite rows break the client boundary. */
function P(r) {
  return r ? { ...r } : r;
}
function PA(rows) {
  return (rows || []).map((r) => ({ ...r }));
}

function slug(s) {
  return (
    String(s || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'other'
  );
}

function nid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

export function insertSave(s) {
  const id = nid('s');
  getDb()
    .prepare(
      `INSERT INTO saves (id, space_id, user_id, original_url, canonical_url, page_title,
        extracted_text, ocr_text, screenshot_path, date_saved, time_saved, tz,
        user_reason, status, created_at, save_type, selection, image_url)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      id, s.space_id, s.user_id, s.original_url, s.canonical_url || null, s.page_title || '',
      s.extracted_text || '', s.ocr_text || '', s.screenshot_path || null,
      s.date_saved, s.time_saved, s.tz || 'UTC', s.user_reason || '',
      s.status || 'capturing', new Date().toISOString(),
      s.save_type || 'page', s.selection || '', s.image_url || null
    );
  return id;
}

export function updateSave(id, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  getDb()
    .prepare(`UPDATE saves SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map((k) => patch[k]), id);
}

export function getSave(id) {
  return P(getDb().prepare('SELECT * FROM saves WHERE id = ?').get(id)) || null;
}

export function getSaveFull(id) {
  const r = getSave(id);
  if (!r) return null;
  return {
    ...r,
    has_shot: Boolean(r.screenshot_path),
    winners: safeParse(r.winners, {}),
    top_signals: safeParse(r.top_signals, []),
    visual_metadata: safeParse(r.visual_metadata, {}),
    classifications: safeParse(r.classifications, {}),
  };
}

function escapeLike(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function listSaves({ limit = 50, type = '', project = '', folder = '', label = '' } = {}) {
  const where = ['deleted_at IS NULL'];
  const args = [];
  if (type) {
    where.push('save_type = ?');
    args.push(type);
  }
  if (project) {
    where.push('project_slug = ?');
    args.push(project);
  }
  if (folder) {
    where.push('folder_slug = ?');
    args.push(folder);
  }
  if (label) {
    // Taxonomy labels live slugged in top_signals, raw or slugged in winners.
    const sl = slug(String(label).slice(0, 80));
    const spaced = sl.replace(/_/g, ' ');
    where.push("(winners LIKE ? ESCAPE '\\' OR winners LIKE ? ESCAPE '\\' OR top_signals LIKE ? ESCAPE '\\')");
    args.push(`%${escapeLike(sl)}%`, `%${escapeLike(spaced)}%`, `%${escapeLike(sl)}%`);
  }
  args.push(Number(limit) || 50);
  const rows = PA(
    getDb()
      .prepare(
        `SELECT id, page_title, original_url, user_reason, status, meta_l1, folder_slug,
        project_slug, save_type, image_url, top_signals, created_at,
        CASE WHEN screenshot_path IS NOT NULL THEN 1 ELSE 0 END has_shot
        FROM saves WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`
      )
      .all(...args)
  );
  return rows.map((r) => ({ ...r, top_signals: safeParse(r.top_signals, []) }));
}

export function counts() {
  const t = getDb()
    .prepare(`SELECT COUNT(*) c, SUM(status='filed') f FROM saves WHERE deleted_at IS NULL`)
    .get();
  return { saves: t.c || 0, filed: t.f || 0 };
}

export function getKnownLabels(spaceId) {
  const rows = getDb()
    .prepare('SELECT set_name, label FROM taxonomy_stats WHERE space_id = ? AND is_seed = 0')
    .all(spaceId);
  const out = {};
  for (const r of rows) (out[r.set_name] = out[r.set_name] || []).push(r.label);
  return out;
}

function bumpStat(spaceId, setName, label, shownAs, isSeed) {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO taxonomy_stats (space_id, set_name, label, shown_as, saves_count,
        is_seed, first_seen_at, last_seen_at) VALUES (?,?,?,?,1,?,?,?)
        ON CONFLICT(space_id,set_name,label) DO UPDATE SET
        saves_count = saves_count + 1, last_seen_at = excluded.last_seen_at`
    )
    .run(spaceId, setName, label, shownAs || label, isSeed ? 1 : 0, now, now);
}

export function upsertTaxonomyStats(spaceId, winners, added, visualOut) {
  const addedSet = new Set((added || []).map((a) => `${a.set}:${a.label}`));
  for (const [set, w] of Object.entries(winners || {})) {
    if (!w || !w.label) continue;
    bumpStat(spaceId, set, w.label, w.label, !addedSet.has(`${set}:${w.label}`));
  }
  const now = new Date().toISOString();
  for (const a of added || []) {
    if (winners?.[a.set]?.label === a.label) continue;
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO taxonomy_stats (space_id, set_name, label, shown_as,
          saves_count, is_seed, first_seen_at, last_seen_at) VALUES (?,?,?,?,0,0,?,?)`
      )
      .run(spaceId, a.set, a.label, a.label, now, now);
  }
  const aesthetics = (visualOut && visualOut.aesthetics) || [];
  for (const a of aesthetics.slice(0, 4)) {
    if (a) bumpStat(spaceId, 'aesthetic', slug(a), String(a), false);
  }
  const regions = (visualOut && visualOut.regions) || [];
  for (const r of regions.slice(0, 12)) {
    if (r && r.label) bumpStat(spaceId, 'visual_label', slug(r.label), String(r.label), false);
  }
}

export function getMemoryRows(spaceId) {
  return getDb()
    .prepare('SELECT layer, key, value, confidence, expires_at FROM user_memory WHERE space_id = ?')
    .all(spaceId)
    .map((r) => ({ ...r, value: safeParse(r.value, r.value) }));
}

export function topStats(spaceId, setName, n = 8) {
  return PA(
    getDb()
      .prepare(
        `SELECT label, saves_count FROM taxonomy_stats WHERE space_id = ? AND set_name = ?
        ORDER BY saves_count DESC LIMIT ?`
      )
      .all(spaceId, setName, n)
  );
}

/* ---------- projects ---------- */

export function listProjects(status = '') {
  const where = status ? 'WHERE status = ?' : '';
  const args = status ? [status] : [];
  const rows = PA(getDb().prepare(`SELECT * FROM projects ${where} ORDER BY updated_at DESC`).all(...args));
  return rows.map((p) => ({
    ...p,
    saves: getDb()
      .prepare('SELECT COUNT(*) c FROM saves WHERE project_slug = ? AND deleted_at IS NULL')
      .get(p.slug).c,
    drafts: getDb().prepare('SELECT COUNT(*) c FROM drafts WHERE project_id = ?').get(p.id).c,
    conversations: getDb()
      .prepare('SELECT COUNT(*) c FROM conversations WHERE project_id = ?')
      .get(p.id).c,
  }));
}

export function getProjectBySlug(spaceId, projectSlug) {
  return (
    P(getDb().prepare('SELECT * FROM projects WHERE space_id = ? AND slug = ?').get(spaceId, projectSlug)) ||
    null
  );
}

export function createProject(spaceId, name, intention = '') {
  const id = nid('p');
  const base = slug(name).replace(/_/g, '-') || 'project';
  let projectSlug = base;
  let n = 2;
  while (getProjectBySlug(spaceId, projectSlug)) projectSlug = `${base}-${n++}`;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO projects (id, space_id, name, slug, intention, status, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?)`
    )
    .run(id, spaceId, name, projectSlug, intention, 'active', now, now);
  return getProjectBySlug(spaceId, projectSlug);
}

export function setSaveProject(id, projectSlug) {
  updateSave(id, { project_slug: projectSlug || null });
}

/* ---------- folders ---------- */

export function savesByFolder(spaceId) {
  return PA(
    getDb()
      .prepare(
        `SELECT COALESCE(folder_slug, 'loose-threads') folder, COUNT(*) n,
        MAX(created_at) latest FROM saves
        WHERE space_id = ? AND deleted_at IS NULL GROUP BY folder ORDER BY n DESC`
      )
      .all(spaceId)
  );
}

export function folderActivity(spaceId, limit = 8) {
  return PA(
    getDb()
      .prepare(
        `SELECT id, page_title, folder_slug, created_at FROM saves
        WHERE space_id = ? AND deleted_at IS NULL AND status = 'filed'
        ORDER BY created_at DESC LIMIT ?`
      )
      .all(spaceId, limit)
  );
}

/* ---------- conversations / think ---------- */

export function createConversation(spaceId, title = '', projectId = null) {
  const id = nid('c');
  getDb()
    .prepare('INSERT INTO conversations (id, space_id, project_id, title, created_at) VALUES (?,?,?,?,?)')
    .run(id, spaceId, projectId, title, new Date().toISOString());
  return id;
}

export function addMessage(conversationId, role, content, citedSaveIds = [], refIds = []) {
  const id = nid('m');
  getDb()
    .prepare(
      'INSERT INTO messages (id, conversation_id, role, content, cited_save_ids, ref_ids, created_at) VALUES (?,?,?,?,?,?,?)'
    )
    .run(id, conversationId, role, content, JSON.stringify(citedSaveIds), JSON.stringify(refIds), new Date().toISOString());
  return id;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Expand save ids into Think ref cards (numbered in the given order). */
export function getRefCards(ids) {
  const list = (ids || []).filter((x) => typeof x === 'string');
  if (!list.length) return [];
  const rows = PA(
    getDb()
      .prepare(
        `SELECT id, page_title, original_url, user_reason, extracted_text, selection,
          CASE WHEN screenshot_path IS NOT NULL THEN 1 ELSE 0 END has_shot
          FROM saves WHERE id IN (${list.map(() => '?').join(',')})`
      )
      .all(...list)
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return list
    .map((id, i) => {
      const r = byId.get(id);
      if (!r) return null;
      return {
        n: i + 1,
        id: r.id,
        title: r.page_title || '(untitled)',
        host: hostOf(r.original_url),
        reason: r.user_reason || '',
        excerpt: String(r.selection || r.extracted_text || '').slice(0, 320),
        has_shot: Boolean(r.has_shot),
      };
    })
    .filter(Boolean);
}

export function getThread(conversationId) {
  const conv = P(getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId)) || null;
  if (!conv) return null;
  const messages = PA(
    getDb().prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId)
  ).map((m) => {
    const ref_ids = safeParse(m.ref_ids, []);
    return {
      ...m,
      cited_save_ids: safeParse(m.cited_save_ids, []),
      ref_ids,
      refs: m.role === 'assistant' && ref_ids.length ? getRefCards(ref_ids) : [],
    };
  });
  return { ...conv, messages };
}

/** Idempotent share link token for a conversation. */
export function ensureShareToken(conversationId) {
  const conv = getDb().prepare('SELECT share_token FROM conversations WHERE id = ?').get(conversationId);
  if (!conv) return null;
  if (conv.share_token) return conv.share_token;
  const token = `sh_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  getDb().prepare('UPDATE conversations SET share_token = ? WHERE id = ?').run(token, conversationId);
  return token;
}

export function getThreadByShareToken(token) {
  if (!token) return null;
  const conv = P(getDb().prepare('SELECT * FROM conversations WHERE share_token = ?').get(token)) || null;
  if (!conv) return null;
  return getThread(conv.id);
}

export function listConversations(spaceId, limit = 10) {
  return PA(
    getDb().prepare('SELECT * FROM conversations WHERE space_id = ? ORDER BY created_at DESC LIMIT ?').all(spaceId, limit)
  );
}

export function deleteConversation(conversationId) {
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
}

export function clearConversations(spaceId) {
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE space_id = ?)').run(
    spaceId
  );
  db.prepare('DELETE FROM conversations WHERE space_id = ?').run(spaceId);
}

/* ---------- drafts ---------- */

export function draftCount(spaceId = 'local-dev') {
  return getDb().prepare('SELECT COUNT(*) c FROM drafts WHERE space_id = ?').get(spaceId).c || 0;
}

export function listDrafts(spaceId = 'local-dev') {
  return PA(getDb().prepare('SELECT * FROM drafts WHERE space_id = ? ORDER BY updated_at DESC').all(spaceId)).map(
    (d) => ({ ...d, linked_save_ids: safeParse(d.linked_save_ids, []) })
  );
}

export function getDraft(id) {
  const d = P(getDb().prepare('SELECT * FROM drafts WHERE id = ?').get(id)) || null;
  return d ? { ...d, linked_save_ids: safeParse(d.linked_save_ids, []) } : null;
}

export function createDraft({ spaceId, projectId = null, conversationId = null, title, body, linkedSaveIds = [] }) {
  const id = nid('d');
  const now = new Date().toISOString();
  const words = String(body || '').split(/\s+/).filter(Boolean).length;
  getDb()
    .prepare(
      `INSERT INTO drafts (id, space_id, project_id, conversation_id, title, body,
        linked_save_ids, word_count, updated_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(id, spaceId, projectId, conversationId, title, body || '', JSON.stringify(linkedSaveIds), words, now, now);
  return getDraft(id);
}

export function updateDraft(id, { title, body }) {
  const now = new Date().toISOString();
  const words = String(body || '').split(/\s+/).filter(Boolean).length;
  getDb()
    .prepare('UPDATE drafts SET title = ?, body = ?, word_count = ?, updated_at = ? WHERE id = ?')
    .run(title, body || '', words, now, id);
  return getDraft(id);
}

/* ---------- resources / trash / search ---------- */

export function setResource(id, on, kind = 'reading') {
  updateSave(id, { is_resource: on ? 1 : 0, resource_kind: on ? kind : null });
}

export function listResources(spaceId = 'local-dev') {
  return PA(
    getDb()
      .prepare(
        `SELECT id, page_title, original_url, resource_kind, folder_slug, created_at FROM saves
        WHERE space_id = ? AND is_resource = 1 AND deleted_at IS NULL ORDER BY created_at DESC`
      )
      .all(spaceId)
  );
}

export function trashSave(id) {
  updateSave(id, { deleted_at: new Date().toISOString() });
}

export function restoreSave(id) {
  updateSave(id, { deleted_at: null });
}

export function listTrash(spaceId = 'local-dev') {
  return PA(
    getDb()
      .prepare(
        `SELECT id, page_title, original_url, save_type, folder_slug, deleted_at FROM saves
        WHERE space_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`
      )
      .all(spaceId)
  );
}

export function emptyTrash(spaceId = 'local-dev') {
  getDb().prepare('DELETE FROM saves WHERE space_id = ? AND deleted_at IS NOT NULL').run(spaceId);
}

export function searchAll(spaceId, q) {
  const like = `%${String(q || '').slice(0, 80)}%`;
  const saves = getDb()
    .prepare(
      `SELECT id, page_title title, original_url sub FROM saves
        WHERE space_id = ? AND deleted_at IS NULL
        AND (page_title LIKE ? OR user_reason LIKE ? OR original_url LIKE ?
          OR extracted_text LIKE ? OR selection LIKE ?)
        ORDER BY created_at DESC LIMIT 6`
    )
    .all(spaceId, like, like, like, like, like)
    .map((r) => ({ kind: 'save', id: r.id, title: r.title || '(untitled)', sub: r.sub, href: `/recents/${r.id}` }));
  const projects = getDb()
    .prepare('SELECT slug id, name title FROM projects WHERE space_id = ? AND name LIKE ? LIMIT 3')
    .all(spaceId, like)
    .map((r) => ({ kind: 'project', id: r.id, title: r.title, sub: 'Project', href: `/projects/${r.id}` }));
  const drafts = getDb()
    .prepare('SELECT id, title FROM drafts WHERE space_id = ? AND (title LIKE ? OR body LIKE ?) LIMIT 3')
    .all(spaceId, like, like)
    .map((r) => ({ kind: 'draft', id: r.id, title: r.title, sub: 'Draft', href: `/drafts/${r.id}` }));
  const exact = [...saves, ...projects, ...drafts].slice(0, 10);
  if (exact.length >= 10 || String(q || '').trim().length < 3) return exact;
  // Typo pass: fuzzy-fill the remaining slots, exact matches stay first.
  const seen = new Set(exact.map((h) => `${h.kind}:${h.id}`));
  const pool = [];
  for (const r of getDb()
    .prepare(
      `SELECT id, page_title title, original_url sub FROM saves
        WHERE space_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`
    )
    .all(spaceId)) {
    if (!seen.has(`save:${r.id}`)) {
      pool.push({ kind: 'save', id: r.id, title: r.title || '(untitled)', sub: r.sub, href: `/recents/${r.id}` });
    }
  }
  for (const r of getDb().prepare('SELECT slug id, name title FROM projects WHERE space_id = ?').all(spaceId)) {
    if (!seen.has(`project:${r.id}`)) {
      pool.push({ kind: 'project', id: r.id, title: r.title, sub: 'Project', href: `/projects/${r.id}` });
    }
  }
  for (const r of getDb().prepare('SELECT id, title FROM drafts WHERE space_id = ?').all(spaceId)) {
    if (!seen.has(`draft:${r.id}`)) {
      pool.push({ kind: 'draft', id: r.id, title: r.title, sub: 'Draft', href: `/drafts/${r.id}` });
    }
  }
  const scored = [];
  for (const c of pool) {
    const s = fuzzyScore(q, `${c.title} ${c.sub || ''}`);
    if (s > 0) scored.push({ c, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return [...exact, ...scored.slice(0, 10 - exact.length).map(({ c }) => ({ ...c, fuzzy: true }))];
}

/* ---------- users / metering ---------- */

export function listUsers() {
  return PA(getDb().prepare('SELECT * FROM users ORDER BY created_at ASC').all()).map((u) => {
    const agg = getDb()
      .prepare(
        `SELECT COUNT(*) calls, COALESCE(SUM(in_tokens),0) in_t, COALESCE(SUM(out_tokens),0) out_t,
          COALESCE(SUM(cost_usd),0) cost, MAX(created_at) last_seen
          FROM usage_events WHERE user_id = ?`
      )
      .get(u.id);
    return {
      ...u,
      calls: agg.calls,
      tokens_used: agg.in_t + agg.out_t,
      cost_usd: Math.round(agg.cost * 1000000) / 1000000,
      last_seen: agg.last_seen,
    };
  });
}

export function getUser(id) {
  return P(getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)) || null;
}

export function createUser({ email, name = '' }) {
  const id = nid('u');
  getDb()
    .prepare('INSERT INTO users (id, email, name, status, created_at) VALUES (?,?,?,\'active\',?)')
    .run(id, String(email).trim().toLowerCase(), String(name || '').slice(0, 120), new Date().toISOString());
  return getUser(id);
}

export function setUserStatus(id, status) {
  if (!['active', 'banned'].includes(status)) throw new Error('bad status');
  getDb().prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
}

export function setUserLimit(id, limit) {
  getDb().prepare('UPDATE users SET token_limit = ? WHERE id = ?').run(limit === null ? null : Number(limit), id);
}

export function userTokensUsed(userId) {
  const r = getDb()
    .prepare('SELECT COALESCE(SUM(in_tokens),0) + COALESCE(SUM(out_tokens),0) t FROM usage_events WHERE user_id = ?')
    .get(userId);
  return r.t || 0;
}

/** Gate every AI call. Returns { ok, reason? } with reason in banned|limit|nouser. */
export function checkBudget(userId) {
  const u = getUser(userId);
  if (!u) return { ok: false, reason: 'nouser' };
  if (u.status === 'banned') return { ok: false, reason: 'banned' };
  if (u.token_limit !== null && u.token_limit !== undefined && userTokensUsed(userId) >= u.token_limit) {
    return { ok: false, reason: 'limit' };
  }
  return { ok: true };
}

export function getRates() {
  return PA(getDb().prepare('SELECT * FROM model_rates ORDER BY model ASC').all());
}

export function setRate(model, { per_1m_in = null, per_1m_out = null, per_unit = null, unit = null } = {}) {
  getDb()
    .prepare(
      `INSERT INTO model_rates (model, per_1m_in, per_1m_out, per_unit, unit, source)
       VALUES (?,?,?,?,?,?) ON CONFLICT(model) DO UPDATE SET
       per_1m_in = excluded.per_1m_in, per_1m_out = excluded.per_1m_out,
       per_unit = excluded.per_unit, unit = excluded.unit, source = excluded.source`
    )
    .run(model, per_1m_in, per_1m_out, per_unit, unit, 'admin');
}

function costFor(model, inTokens, outTokens, units) {
  const r = getDb().prepare('SELECT * FROM model_rates WHERE model = ?').get(model);
  if (!r) return null;
  let cost = 0;
  let known = false;
  if (r.per_1m_in !== null) {
    cost += ((inTokens || 0) / 1000000) * r.per_1m_in;
    known = true;
  }
  if (r.per_1m_out !== null) {
    cost += ((outTokens || 0) / 1000000) * r.per_1m_out;
    known = true;
  }
  if (r.per_unit !== null) {
    cost += (units || 0) * r.per_unit;
    known = true;
  }
  return known ? cost : null;
}

export function logUsage({ spaceId, userId, kind, model, inTokens = 0, outTokens = 0, units = 0 }) {
  const cost = costFor(model, inTokens, outTokens, units);
  getDb()
    .prepare(
      `INSERT INTO usage_events (id, space_id, user_id, kind, model, in_tokens, out_tokens, units, cost_usd, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(nid('e'), spaceId, userId, kind, model, inTokens, outTokens, units, cost, new Date().toISOString());
  return { cost_usd: cost };
}

/* ---------- memory writes / wipe ---------- */

export function putMemoryRow(spaceId, layer, key, value, confidence = 90) {
  getDb()
    .prepare(
      `INSERT INTO user_memory (space_id, layer, key, value, confidence, updated_at)
       VALUES (?,?,?,?,?,?) ON CONFLICT(space_id, layer, key) DO UPDATE SET
       value = excluded.value, confidence = excluded.confidence, updated_at = excluded.updated_at`
    )
    .run(spaceId, layer, key, JSON.stringify(value), confidence, new Date().toISOString());
}

/** Permanent wipe of the user-data plane (admin plane kept). Returns counts + shot paths. */
export function wipeSpace(spaceId) {
  const db = getDb();
  const shots = db
    .prepare('SELECT screenshot_path FROM saves WHERE space_id = ? AND screenshot_path IS NOT NULL')
    .all(spaceId)
    .map((r) => r.screenshot_path);
  const del = (table, extra = '') =>
    db.prepare(`DELETE FROM ${table} WHERE space_id = ? ${extra}`).run(spaceId).changes;
  const counts = {
    saves: del('saves'),
    user_memory: del('user_memory'),
    taxonomy_stats: del('taxonomy_stats'),
    drafts: del('drafts'),
    projects: del('projects'),
  };
  counts.messages = db
    .prepare('DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE space_id = ?)')
    .run(spaceId).changes;
  counts.conversations = del('conversations');
  return { counts, shots };
}
