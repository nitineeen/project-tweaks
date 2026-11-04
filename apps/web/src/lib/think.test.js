'use strict';

// Think threads: follow-ups continue the same conversation and the agent sees
// thread history (mock echoes a follow-up marker proving the wiring).
// Run: npm test (node --test, no dependencies).

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.SQLITE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tweaks-think-test-')), 't.db');
process.env.AI_PROVIDER = 'mock';

const db = require('./db.js');
let think;

before(async () => {
  think = await import('./think.js');
  db.getDb();
  db.insertSave({
    space_id: 'local-dev', user_id: 'u', original_url: 'https://ex.com/a',
    page_title: 'Calm interfaces', extracted_text: 'attention and calm software design',
    user_reason: 'research for article', date_saved: '2026-11-05', time_saved: '10:00:00',
    status: 'filed',
  });
});

test('follow-ups continue the same thread and see history', async () => {
  const first = await think.runThink({ spaceId: 'local-dev', query: 'What do my saves say about calm software?' });
  assert.ok(first.conversationId);
  assert.ok(!first.answer.includes('Following up'));
  const second = await think.runThink({
    spaceId: 'local-dev',
    query: 'Which one should I read first?',
    conversationId: first.conversationId,
  });
  assert.strictEqual(second.conversationId, first.conversationId);
  assert.ok(second.answer.includes('Following up (2 earlier messages)'));
  const thread = db.getThread(first.conversationId);
  assert.strictEqual(thread.messages.length, 4);
  assert.deepStrictEqual(thread.messages[3].cited_save_ids, second.cited);
});

test('each answer keeps its own ref snapshot for citations', async () => {
  const save = db.listSaves({})[0];
  const r = await think.runThink({ spaceId: 'local-dev', query: 'calm software', pinIds: [save.id] });
  const thread = db.getThread(r.conversationId);
  const last = thread.messages[thread.messages.length - 1];
  assert.strictEqual(last.role, 'assistant');
  assert.deepStrictEqual(last.ref_ids, [save.id]);
  assert.strictEqual(last.refs.length, 1);
  assert.strictEqual(last.refs[0].id, save.id);
  assert.strictEqual(last.refs[0].n, 1);
  // A later answer with different refs must not rewrite the earlier snapshot.
  const r2 = await think.runThink({
    spaceId: 'local-dev', query: 'xyzzy-no-match-at-all', conversationId: r.conversationId,
  });
  assert.strictEqual(r2.conversationId, r.conversationId);
  const thread2 = db.getThread(r.conversationId);
  assert.deepStrictEqual(thread2.messages[1].ref_ids, [save.id]);
  assert.strictEqual(thread2.messages[1].refs[0].id, save.id);
  assert.deepStrictEqual(thread2.messages[3].ref_ids, []);
});

test('chat remembers your name and recalls it later', async () => {
  const w = await think.runThink({ spaceId: 'local-dev', query: 'Call me James Allen' });
  assert.ok(w.memWrites.some((m) => m.key === 'name' && m.value === 'James Allen'));
  assert.ok(w.answer.includes('James Allen'));
  const rows = db.getMemoryRows('local-dev');
  assert.strictEqual(rows.find((r) => r.key === 'name').value, 'James Allen');
  const r = await think.runThink({ spaceId: 'local-dev', query: 'What is my name?' });
  assert.ok(r.answer.includes('James Allen'), 'recall must use memory, not references');
});

test('a new chat can name earlier conversations', async () => {
  const p = await think.runThink({ spaceId: 'local-dev', query: 'What did we talk about before?' });
  assert.ok(p.answer.includes('Call me James Allen'));
});

test('empty exact search falls back to loose matches', async () => {
  assert.strictEqual(think.retrieve('local-dev', 'calming routines').length, 0);
  const loose = think.retrieveLoose('local-dev', 'calming routines');
  assert.ok(loose.length >= 1);
  assert.strictEqual(loose[0].loose, true);
  const r = await think.runThink({ spaceId: 'local-dev', query: 'calming routines' });
  assert.ok(r.refs.length >= 1);
  assert.ok(r.answer.includes('[1]'));
});

test('pinned ids join context without keyword match', async () => {
  const save = db.listSaves({})[0];
  const refs = think.retrieve('local-dev', 'xyzzy-no-match-at-all', { pinIds: [save.id] });
  assert.strictEqual(refs.length, 1);
  assert.strictEqual(refs[0].id, save.id);
});
