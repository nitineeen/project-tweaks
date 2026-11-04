'use strict';

// Typo-tolerant ⌘K search: unit checks for the scorer plus an end-to-end
// searchAll pass over fixtures (exact first, fuzzy fills, gibberish empty).
// Run: npm test (node --test, no dependencies).

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.SQLITE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tweaks-fuzzy-test-')), 't.db');

const db = require('./db.js');
let fuzzy;

before(async () => {
  fuzzy = await import('./fuzzy.js');
  db.getDb();
  db.insertSave({
    space_id: 'local-dev', user_id: 'u', original_url: 'https://ex.com/calm',
    page_title: 'Calm interfaces', extracted_text: 'attention and calm software',
    user_reason: 'research for article', date_saved: '2026-11-05', time_saved: '10:00:00',
    status: 'filed',
  });
  db.createProject('local-dev', 'Slower Internet');
});

test('scorer catches transpositions, deletions, and rejects strangers', () => {
  assert.strictEqual(fuzzy.damerau('clam', 'calm'), 1);
  assert.ok(fuzzy.similarity('clam', 'calm') > 0.7);
  assert.ok(fuzzy.similarity('interfacs', 'interfaces') > 0.85);
  assert.ok(fuzzy.similarity('xyzzy', 'calm') < 0.4);
  assert.ok(fuzzy.fuzzyScore('clam interfacs', 'Calm interfaces https://ex.com/calm') > 0);
  assert.strictEqual(fuzzy.fuzzyScore('zzzqqq', 'Calm interfaces'), 0);
});

test('misspelled query still finds the save as a close match', () => {
  const hits = db.searchAll('local-dev', 'clam interfacs');
  const save = hits.find((h) => h.kind === 'save' && h.title === 'Calm interfaces');
  assert.ok(save, 'typo should still match');
  assert.strictEqual(save.fuzzy, true);
});

test('exact matches stay first and unflagged', () => {
  const hits = db.searchAll('local-dev', 'calm');
  assert.ok(hits.length >= 1);
  assert.strictEqual(hits[0].title, 'Calm interfaces');
  assert.strictEqual(hits[0].fuzzy, undefined);
});

test('gibberish returns no fuzzy filler', () => {
  assert.deepStrictEqual(db.searchAll('local-dev', 'zzzqqq'), []);
});
