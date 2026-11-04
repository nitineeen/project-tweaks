'use strict';

/**
 * Memory layers for memory-spec.md. Pure helpers, no I/O.
 * Storage lives behind MemoryStore (backend P0); these shape reads.
 */

const LAYERS = {
  permanent: { ttlHours: null, desc: 'identity: name, email, addresses' },
  occupational: { ttlHours: null, desc: 'role, company, slow-changing' },
  dynamic: { ttlHours: null, desc: 'interests + current project, recomputed from stats' },
  temporary: { ttlHours: 24, desc: 'session/task scope' },
};

function isExpired(row, now = Date.now()) {
  if (!row.expires_at) return false;
  return new Date(row.expires_at).getTime() <= now;
}

function liveRows(rows, now = Date.now()) {
  return (rows || []).filter((r) => !isExpired(r, now));
}

function fmt(v) {
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/**
 * Compact block injected into classifier input + think prompts. Small on purpose.
 * rows: user_memory rows. stats: [{label, saves_count}] top interests, pre-sorted.
 */
function buildMemoryBlock(rows, stats, now = Date.now()) {
  const live = liveRows(rows, now);
  const get = (layer, key) => live.find((r) => r.layer === layer && r.key === key)?.value;
  const lines = [];
  const name = get('permanent', 'name');
  if (name) lines.push(`User: ${fmt(name)}`);
  const role = get('occupational', 'role');
  if (role) lines.push(`Role: ${fmt(role)}`);
  const project = get('dynamic', 'current_project');
  if (project) lines.push(`Current project: ${fmt(project)}`);
  const interests = (stats || []).slice(0, 5).map((s) => s.label).join(', ');
  if (interests) lines.push(`Top interests: ${interests}`);
  const task = get('temporary', 'current_task');
  if (task) lines.push(`Right now: ${fmt(task)}`);
  return lines.join('\n');
}

module.exports = { LAYERS, isExpired, liveRows, buildMemoryBlock };
