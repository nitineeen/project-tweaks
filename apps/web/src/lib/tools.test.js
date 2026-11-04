'use strict';

// Deep-agent tools + loop. Executors run against fixtures; the loop runs
// against a scripted model (no gateway). Page fetching is tested over a
// data: URL — no sockets, hermetic under sandboxes that forbid listen().
// Run: npm test (node --test, no dependencies).

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.SQLITE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tweaks-tools-test-')), 't.db');
delete process.env.SEARCH_API_KEY;

const db = require('./db.js');
let tools;
let agent;
let saveId;

before(async () => {
  tools = await import('./tools.js');
  agent = await import('./agent.js');
  db.getDb();
  saveId = db.insertSave({
    space_id: 'local-dev', user_id: 'u', original_url: 'https://ex.com/calm',
    page_title: 'Calm interfaces', extracted_text: 'attention and calm software design patterns',
    user_reason: 'research for article', date_saved: '2026-11-05', time_saved: '10:00:00',
    status: 'filed',
  });
});

test('search_saves numbers matches and read_save returns full text', async () => {
  const ctx = tools.createToolContext('local-dev', []);
  const out = await tools.runTool(ctx, 'search_saves', { query: 'calm software' });
  assert.ok(out.includes('[1] Calm interfaces'));
  assert.ok(out.includes(`id:${saveId}`));
  const full = await tools.runTool(ctx, 'read_save', { id: saveId });
  assert.ok(full.includes('[1] Calm interfaces'));
  assert.ok(full.includes('attention and calm software design patterns'));
  assert.ok(full.includes('research for article'));
});

test('search numbering continues past seeded refs without duplication', async () => {
  const ctx = tools.createToolContext('local-dev', [{ id: saveId }]);
  const out = await tools.runTool(ctx, 'search_saves', { query: 'calm' });
  assert.ok(out.includes('[1] Calm interfaces'), 'known save keeps its number');
  assert.strictEqual(ctx.order.length, 1);
});

test('read_save on unknown id guides back to search', async () => {
  const ctx = tools.createToolContext('local-dev', []);
  const out = await tools.runTool(ctx, 'read_save', { id: 's_nope' });
  assert.ok(out.includes('search_saves'));
});

test('remember stores durable facts', async () => {
  const ctx = tools.createToolContext('local-dev', []);
  const out = await tools.runTool(ctx, 'remember', { key: 'favorite_color', value: 'ochre', layer: 'permanent' });
  assert.ok(out.includes('Remembered'));
  const rows = db.getMemoryRows('local-dev');
  assert.strictEqual(rows.find((r) => r.key === 'favorite_color').value, 'ochre');
});

test('fetch_page reads page text, drops boilerplate', async () => {
  // data: URL — no sockets, hermetic under sandboxes that forbid listen().
  const page = 'data:text/html,' + encodeURIComponent(
    '<html><head><title>Live Page</title></head><body><nav>menu</nav><p>Fresh content here.</p><script>var x=1;</script></body></html>'
  );
  const ctx = tools.createToolContext('local-dev', []);
  const { fetchPageText } = await import('./enrich.js');
  const direct = await fetchPageText(page);
  assert.strictEqual(direct.title, 'Live Page');
  assert.ok(direct.text.includes('Fresh content here.'));
  assert.ok(!direct.text.includes('var x=1'));
  assert.ok(!direct.text.includes('menu'));
  // The tool itself rejects non-http(s) input with guidance (SSRF guard).
  const bad = await tools.runTool(ctx, 'fetch_page', { url: 'not-a-url' });
  assert.ok(bad.includes('http(s)'));
});

test('web_search without a key says so honestly', async () => {
  const ctx = tools.createToolContext('local-dev', []);
  const out = await tools.runTool(ctx, 'web_search', { query: 'anything' });
  assert.ok(out.includes('not configured'));
});

test('loop runs tools, sums usage, and returns the final answer', async () => {
  const ctx = tools.createToolContext('local-dev', []);
  const script = [
    { content: '', toolCalls: [{ id: 'c1', name: 'search_saves', args: { query: 'calm' } }], usage: { in: 10, out: 5 } },
    { content: 'Calm wins [1]. Used: [1]', toolCalls: [], usage: { in: 20, out: 10 } },
  ];
  let i = 0;
  const seen = [];
  const { text, usage } = await agent.runToolLoop({
    model: 'x', system: 's', userText: 'q',
    toolDefs: tools.TOOL_DEFS,
    runTool: (n, a) => tools.runTool(ctx, n, a),
    maxRounds: 3,
    onTool: (name) => seen.push(name),
    chat: async () => ({ ...script[Math.min(i++, script.length - 1)] }),
  });
  assert.strictEqual(text, 'Calm wins [1]. Used: [1]');
  assert.deepStrictEqual(seen, ['search_saves']);
  assert.strictEqual(usage.in, 30);
  assert.strictEqual(usage.out, 15);
  assert.deepStrictEqual(ctx.order, [saveId]);
});

test('loop survives unknown tools and caps runaway rounds', async () => {
  const ctx = tools.createToolContext('local-dev', []);
  let calls = 0;
  const { text } = await agent.runToolLoop({
    model: 'x', system: 's', userText: 'q',
    toolDefs: tools.TOOL_DEFS,
    runTool: (n, a) => tools.runTool(ctx, n, a),
    maxRounds: 2,
    chat: async (messages) => {
      calls += 1;
      const last = messages[messages.length - 1];
      if (last.role === 'user' && String(last.content).startsWith('Answer now')) {
        return { content: 'Giving up gracefully. Used: nothing yet', toolCalls: [], usage: { in: 1, out: 1 } };
      }
      const name = calls === 1 ? 'nope_not_a_tool' : 'search_saves';
      return { content: '', toolCalls: [{ id: `c${calls}`, name, args: { query: 'calm' } }], usage: { in: 1, out: 1 } };
    },
  });
  assert.strictEqual(calls, 3, '2 rounds + final nudge');
  assert.ok(text.includes('Giving up gracefully'));
});
