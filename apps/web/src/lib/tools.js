import { getDb, getSaveFull, putMemoryRow } from './db.js';
import { retrieve, retrieveLoose } from './think.js';
import { fetchPageText } from './enrich.js';

/**
 * Think-agent tools (Deep mode). Executors share a numbering context so the
 * [n] chips the model writes always resolve: seed with the initial refs,
 * tool-found saves append numbers in encounter order.
 */

export const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'search_saves',
      description: 'Search the person\'s saved sparks by keywords. Returns numbered matches ([n] + id). Use when the provided references are thin or a follow-up needs different saves.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords to search for.' },
          limit: { type: 'integer', description: 'Max matches (default 5, cap 10).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_save',
      description: 'Read the full text and filing of one save by its id. Use before citing a save you have only seen as a one-line match.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Save id (the id: field from search_saves).' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_page',
      description: 'Fetch a live URL and read its current text. Use when the user gave a link, or a save looks stale. Cite fetched pages by title + URL, never [n].',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full http(s) URL to fetch.' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description: 'Store a durable fact about the person (name, role, project, preference). Use when they state something worth keeping across chats.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Short key, e.g. name, role, current_project, likes.' },
          value: { type: 'string', description: 'The fact to remember.' },
          layer: {
            type: 'string',
            description: 'permanent (identity), occupational (work), dynamic (projects), temporary (now).',
            enum: ['permanent', 'occupational', 'dynamic', 'temporary'],
          },
        },
        required: ['key', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the live web. Only available when a search key is configured; otherwise it says so — then work from saves and fetched pages instead.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Web search query.' },
        },
        required: ['query'],
      },
    },
  },
];

export function createToolContext(spaceId, initialRefs = []) {
  return { spaceId, order: initialRefs.map((r) => r.id) };
}

function numberOf(ctx, id) {
  let n = ctx.order.indexOf(id);
  if (n < 0) {
    ctx.order.push(id);
    n = ctx.order.length - 1;
  }
  return n + 1;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function execSearch(ctx, { query, limit }) {
  const q = String(query || '').slice(0, 300);
  if (!q.trim()) return 'Empty query — nothing searched.';
  const n = Math.min(Math.max(Number(limit) || 5, 1), 10);
  let hits = retrieve(ctx.spaceId, q, { limit: n });
  if (!hits.length) hits = retrieveLoose(ctx.spaceId, q, { limit: n });
  if (!hits.length) return `No saves match "${q}". Try different words, or fetch_page on a link.`;
  return hits
    .map((h) => {
      const num = numberOf(ctx, h.id);
      const blurb = (h.reason || h.excerpt || '').slice(0, 140).replace(/\n/g, ' ');
      return `[${num}] ${h.title} (${h.host || hostOf('')}) id:${h.id} — ${blurb || 'no excerpt'}`;
    })
    .join('\n');
}

async function execRead(ctx, { id }) {
  const save = getSaveFull(String(id || ''));
  if (!save) return `No save with id "${String(id || '').slice(0, 60)}". Use an id: from search_saves.`;
  const num = numberOf(ctx, save.id);
  const winners = Object.entries(save.winners || {})
    .map(([set, w]) => `${set}=${w && w.label}`)
    .join(', ');
  const aesthetics = ((save.visual_metadata || {}).aesthetics || []).join(', ');
  return [
    `[${num}] ${save.page_title || '(untitled)'}`,
    `URL: ${save.original_url}`,
    `Type: ${save.save_type || 'page'} · Saved for: ${save.user_reason || '—'}`,
    winners ? `Filed as: ${winners}` : null,
    aesthetics ? `Aesthetics: ${aesthetics}` : null,
    `Text:\n${String(save.selection || save.extracted_text || '(no captured text)').slice(0, 4000)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function execFetch(ctx, { url }) {
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return 'Give a full http(s) URL.';
  const page = await fetchPageText(u);
  if (!page.text) return `Could not read ${u} (blocked, empty, or not HTML). Work from saves instead.`;
  return [`Fetched: ${page.title || u}`, `URL: ${page.finalUrl || u}`, `Text:\n${page.text.slice(0, 6000)}`].join('\n');
}

const LAYERS = new Set(['permanent', 'occupational', 'dynamic', 'temporary']);

async function execRemember(ctx, { key, value, layer }) {
  const k = String(key || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60);
  const v = String(value || '').trim().slice(0, 500);
  if (!k || !v) return 'Need both a key and a value to remember anything.';
  const lyr = LAYERS.has(layer) ? layer : 'dynamic';
  getDb();
  putMemoryRow(ctx.spaceId, lyr, k, v, 90);
  return `Remembered ${k} = "${v}" (${lyr}). It will appear in future chats and Settings memory.`;
}

async function execWebSearch(ctx, { query }) {
  const key = process.env.SEARCH_API_KEY || '';
  if (!key) {
    return 'Web search is not configured (no SEARCH_API_KEY). Work from the person\'s saves and fetch_page on any links instead.';
  }
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(String(query || '').slice(0, 300))}&count=5`,
      { headers: { 'X-Subscription-Token': key, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return `Web search failed (http ${res.status}). Work from saves instead.`;
    const data = await res.json();
    const results = (data && data.web && data.web.results) || [];
    if (!results.length) return 'No web results. Work from saves instead.';
    return results
      .slice(0, 5)
      .map((r) => `- ${r.title || '(untitled)'}\n  ${r.url || ''}\n  ${String(r.description || '').slice(0, 240)}`)
      .join('\n');
  } catch {
    return 'Web search timed out. Work from saves instead.';
  }
}

const EXECUTORS = {
  search_saves: execSearch,
  read_save: execRead,
  fetch_page: execFetch,
  remember: execRemember,
  web_search: execWebSearch,
};

/** Run one tool call. Never throws — errors come back as text for the model. */
export async function runTool(ctx, name, args) {
  const fn = EXECUTORS[name];
  if (!fn) return `Unknown tool "${name}". Available: ${Object.keys(EXECUTORS).join(', ')}.`;
  try {
    return await fn(ctx, args || {});
  } catch (e) {
    return `Tool ${name} failed: ${String((e && e.message) || e).slice(0, 200)}`;
  }
}
