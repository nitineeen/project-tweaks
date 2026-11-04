'use strict';

// Regression: node:sqlite rows have null prototypes, which Next.js refuses to
// pass to Client Components. Every db getter must return plain objects.
// Run: npm test (node --test, no dependencies).

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.SQLITE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tweaks-test-')), 't.db');

const db = require('./db.js');
const isPlain = (o) => Object.getPrototypeOf(o) === Object.prototype;

before(() => {
  db.getDb();
  const id = db.insertSave({
    space_id: 'local-dev', user_id: 'u', original_url: 'https://ex.com/a',
    page_title: 'A', extracted_text: 'calm design', user_reason: 'I like the design',
    date_saved: '2026-11-05', time_saved: '10:00:00', status: 'filed',
  });
  db.updateSave(id, { folder_slug: 'visual-language', meta_l1: 'design__research' });
  const p = db.createProject('local-dev', 'Proj');
  db.setSaveProject(id, p.slug);
  const c = db.createConversation('local-dev', 't');
  db.addMessage(c, 'user', 'hi', []);
  db.createDraft({ spaceId: 'local-dev', title: 'D', body: 'one two', linkedSaveIds: [id] });
  db.setResource(id, true);
  const tid = db.insertSave({
    space_id: 'local-dev', user_id: 'u', original_url: 'https://ex.com/t',
    page_title: 'T', date_saved: '2026-11-05', time_saved: '10:00:00', status: 'filed',
  });
  db.trashSave(tid);
});

test('client-boundary getters return plain-prototype objects', () => {
  assert.ok(isPlain(db.listSaves({})[0]));
  const save = db.listSaves({})[0];
  assert.ok(isPlain(db.getSaveFull(save.id)));
  assert.ok(isPlain(db.getThread(db.listConversations('local-dev')[0].id)));
  assert.ok(isPlain(db.listConversations('local-dev')[0]));
  assert.ok(isPlain(db.listDrafts()[0]));
  assert.ok(isPlain(db.getDraft(db.listDrafts()[0].id)));
  assert.ok(isPlain(db.listProjects()[0]));
  assert.ok(isPlain(db.getProjectBySlug('local-dev', db.listProjects()[0].slug)));
  assert.ok(isPlain(db.listResources()[0]));
  assert.ok(isPlain(db.listTrash()[0]));
  assert.ok(isPlain(db.savesByFolder('local-dev')[0]));
  assert.ok(db.searchAll('local-dev', 'calm').every(isPlain));
});

test('save round-trips through trash intact', () => {
  const before = db.listSaves({}).length;
  const id = db.listSaves({})[0].id;
  db.trashSave(id);
  assert.strictEqual(db.listSaves({}).length, before - 1);
  db.restoreSave(id);
  assert.strictEqual(db.listSaves({}).length, before);
});

test('users: create, ban, limits gate AI spend', () => {
  const u = db.createUser({ email: 'spendy@test.dev', name: 'Spendy' });
  assert.strictEqual(db.checkBudget(u.id).ok, true);
  assert.strictEqual(db.checkBudget('no-such-user').reason, 'nouser');
  db.setUserStatus(u.id, 'banned');
  assert.strictEqual(db.checkBudget(u.id).reason, 'banned');
  db.setUserStatus(u.id, 'active');
  db.setUserLimit(u.id, 10);
  db.logUsage({ spaceId: 'local-dev', userId: u.id, kind: 'think', model: 'muse-spark-1.3', inTokens: 6, outTokens: 4 });
  assert.strictEqual(db.checkBudget(u.id).reason, 'limit');
  db.setUserLimit(u.id, null);
  assert.strictEqual(db.checkBudget(u.id).ok, true);
  const listed = db.listUsers().find((x) => x.id === u.id);
  assert.strictEqual(listed.tokens_used, 10);
  assert.ok(listed.cost_usd > 0);
});

test('rate card prices usage, unknown models cost null', () => {
  const rates = db.getRates();
  const spark = rates.find((r) => r.model === 'muse-spark-1.3');
  assert.strictEqual(spark.per_1m_in, 1.25);
  assert.strictEqual(spark.per_1m_out, 4.25);
  const priced = db.logUsage({ spaceId: 'local-dev', userId: 'local-user', kind: 'think', model: 'muse-spark-1.3', inTokens: 1000000, outTokens: 1000000 });
  assert.strictEqual(priced.cost_usd, 5.5);
  const unknown = db.logUsage({ spaceId: 'local-dev', userId: 'local-user', kind: 'think', model: 'nope-9', inTokens: 10, outTokens: 10 });
  assert.strictEqual(unknown.cost_usd, null);
  db.setRate('nope-9', { per_1m_in: 1, per_1m_out: 1 });
  assert.strictEqual(db.getRates().find((r) => r.model === 'nope-9').per_1m_in, 1);
});

test('share tokens are idempotent and resolve threads', () => {
  const c = db.createConversation('local-dev', 'share me');
  db.addMessage(c, 'user', 'hello', []);
  const t1 = db.ensureShareToken(c);
  const t2 = db.ensureShareToken(c);
  assert.strictEqual(t1, t2);
  assert.ok(t1.startsWith('sh_'));
  const thread = db.getThreadByShareToken(t1);
  assert.strictEqual(thread.id, c);
  assert.strictEqual(thread.messages.length, 1);
  assert.strictEqual(db.getThreadByShareToken('sh_nope'), null);
  assert.strictEqual(db.ensureShareToken('c_nope'), null);
});

test('threads delete singly and clear-all wipes the space', () => {
  const keep = db.createConversation('local-dev', 'keep me');
  const drop = db.createConversation('local-dev', 'drop me');
  db.addMessage(drop, 'user', 'hi', []);
  db.deleteConversation(drop);
  assert.strictEqual(db.getThread(drop), null);
  assert.ok(db.getThread(keep), 'other threads untouched');
  db.clearConversations('local-dev');
  assert.strictEqual(db.listConversations('local-dev', 50).length, 0);
  assert.strictEqual(db.getThread(keep), null);
});

test('memory writes upsert; wipe clears user plane, keeps admin plane', () => {
  db.putMemoryRow('local-dev', 'permanent', 'name', 'Zed', 100);
  db.putMemoryRow('local-dev', 'permanent', 'name', 'Zed Two', 100);
  const rows = db.getMemoryRows('local-dev');
  assert.strictEqual(rows.filter((r) => r.key === 'name').length, 1);
  assert.strictEqual(rows.find((r) => r.key === 'name').value, 'Zed Two');
  const { counts } = db.wipeSpace('local-dev');
  assert.ok(counts.saves >= 1);
  assert.strictEqual(db.listSaves({}).length, 0);
  assert.strictEqual(db.getMemoryRows('local-dev').length, 0);
  assert.ok(db.listUsers().length >= 1, 'users kept');
  assert.ok(db.getRates().length >= 1, 'rates kept');
});
