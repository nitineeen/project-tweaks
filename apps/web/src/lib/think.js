import { getDb, getThread, createConversation, addMessage, getMemoryRows, topStats, logUsage, putMemoryRow, listConversations, getRefCards } from './db.js';
import { TOOL_DEFS, createToolContext, runTool } from './tools.js';
import { runToolLoop } from './agent.js';
import { buildMemoryBlock } from '../../../../packages/shared/memory.js';
import { chatJSON, chatStream, estTokens } from './ai.js';

const STOP = new Set(
  'what,why,how,when,who,the,and,for,with,from,that,this,are,you,your,about,into,like,just,can,could,would,should,have,has,had,its,of,to,in,on,at,as,an,or,be,is,was,were,do,does,did,not,but,they,them,their,then,than,so,such,more,most,some,any,all,each,very,over,under,between,through,during,there,here,where,which,while,also,onto,out,off,again,once,my,me,we,our'.split(
    ','
  )
);

function tokens(s) {
  return String(s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function hits(text, qs) {
  let h = 0;
  for (const t of tokens(text)) if (qs.has(t)) h += 1;
  return h;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const THINK_SYSTEM = `You are Tweaks' thinking partner. Think step by step, then answer.
Follow this chain in order for every question:
1. ABOUT THEM? If the question is about the person (name, role, project, preferences, anything "my ..."), answer from User memory. If memory is missing it: say so in one line, ask them to tell you, and note you will remember it. Do not touch references for this step.
2. FOLLOW-UP? If it continues this conversation ("that", "it", "more", "why"), use Conversation so far, then the Previous-conversations list. If no thread covers it, say which earlier thread comes closest and ask what they mean.
3. IN THE SAVES? If the question needs saved material, use the numbered references and cite every claim [1], [2]. Never cite a number with no matching reference. Weakly-related references are thin links: cite cautiously and say they are weak.
4. NOTHING COVERS IT? Say what's missing in one line, then say what ELSE can be done: what to save, what to search, or which question to ask instead. Never invent facts.
Always end with a one-line trail — "Used: memory" / "Used: this thread" / "Used: [1][2]" / "Used: nothing yet" — so the person knows why you answered this way.
Be concrete and brief: direct answer first, then at most 3 short directions.
Plain text with simple newlines. You may use **bold** for emphasis and 1. 2. 3. lists. Never output JSON.`;

const DEEP_SUFFIX = `Think mode: take your time. Compare the references against each other, name the tension or pattern between them, then give a fuller recommendation with concrete next steps.`;

const TOOL_GUIDE = `Deep tools: search_saves (more saves, numbered [n] + id), read_save (full text by id — read before citing a one-line match), fetch_page (live URL text; cite by title + URL, never [n]), remember (store durable facts), web_search (may be unconfigured — then say so and use saves).
Rules: at most a few calls; batch independent calls in one round. Never guess what a tool can verify. Keep the [n] numbering you were given; new numbers come only from tool results. End with the Used: trail.`;

function thinkModel(deep) {
  if (deep) return process.env.MODEL_THINK_DEEP || process.env.MODEL_THINK || process.env.MODEL_CLASSIFY || 'muse-spark-1.3';
  return process.env.MODEL_THINK_QUICK || process.env.MODEL_THINK || process.env.MODEL_CLASSIFY || 'muse-spark-1.3';
}

/** Keyword + taxonomy-overlap retrieval over non-trashed saves. Pinned ids always come first. */
export function retrieve(spaceId, query, { limit = 6, projectSlug = '', pinIds = [] } = {}) {
  const db = getDb();
  const qs = new Set(tokens(query));
  const where = ['space_id = ?', 'deleted_at IS NULL'];
  const args = [spaceId];
  if (projectSlug) {
    where.push('project_slug = ?');
    args.push(projectSlug);
  }
  const rows = db
    .prepare(
      `SELECT id, page_title, original_url, user_reason, extracted_text, selection,
        winners, top_signals, created_at,
        CASE WHEN screenshot_path IS NOT NULL THEN 1 ELSE 0 END has_shot
        FROM saves WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 400`
    )
    .all(...args);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const shape = (r, n) => ({
    n,
    id: r.id,
    title: r.page_title || '(untitled)',
    host: hostOf(r.original_url),
    reason: r.user_reason || '',
    excerpt: String(r.selection || r.extracted_text || '').slice(0, 320),
    has_shot: Boolean(r.has_shot),
  });
  const pinned = [];
  for (const pid of pinIds || []) {
    const r = byId.get(pid);
    if (r && !pinned.some((p) => p.id === pid)) pinned.push(r);
  }
  const scored = [];
  if (qs.size) {
    for (const r of rows) {
      if (pinned.some((p) => p.id === r.id)) continue;
      let winnerLabels = '';
      try {
        winnerLabels = Object.values(JSON.parse(r.winners || '{}'))
          .map((x) => x && x.label)
          .join(' ');
      } catch {
        winnerLabels = '';
      }
      let tops = '';
      try {
        tops = JSON.parse(r.top_signals || '[]').join(' ');
      } catch {
        tops = '';
      }
      const daysOld = Math.max(0, (Date.now() - new Date(r.created_at).getTime()) / 86400000);
      const kw =
        hits(r.page_title, qs) * 3 +
        hits(r.user_reason, qs) * 3 +
        hits(r.original_url, qs) +
        hits(`${r.extracted_text || ''} ${r.selection || ''}`, qs) +
        hits(`${winnerLabels} ${tops}`, qs) * 2;
      if (kw <= 0) continue;
      scored.push({ r, score: kw + (1 / (1 + daysOld)) * 0.5 });
    }
    scored.sort((a, b) => b.score - a.score);
  }
  const all = [...pinned, ...scored.map((s) => s.r)].slice(0, limit);
  return all.map((r, i) => shape(r, i + 1));
}

/** Loose second pass: substring match on title/reason/labels when the exact
    pass finds nothing (e.g. "calming" still finds "Calm interfaces"). */
export function retrieveLoose(spaceId, query, { limit = 3 } = {}) {
  const db = getDb();
  const qs = tokens(query);
  if (!qs.length) return [];
  const rows = db
    .prepare(
      `SELECT id, page_title, original_url, user_reason, extracted_text, selection,
        winners, top_signals, created_at,
        CASE WHEN screenshot_path IS NOT NULL THEN 1 ELSE 0 END has_shot
        FROM saves WHERE space_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 400`
    )
    .all(spaceId);
  const scored = [];
  for (const r of rows) {
    let winnerLabels = '';
    try {
      winnerLabels = Object.values(JSON.parse(r.winners || '{}'))
        .map((x) => x && x.label)
        .join(' ');
    } catch {
      winnerLabels = '';
    }
    const hay = `${r.page_title || ''} ${r.user_reason || ''} ${winnerLabels}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2);
    let score = 0;
    for (const t of qs) {
      if (hay.some((w) => w.includes(t) || t.includes(w))) score += 1;
    }
    if (score > 0) scored.push({ r, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ r }, i) => ({
    n: i + 1,
    id: r.id,
    title: r.page_title || '(untitled)',
    host: hostOf(r.original_url),
    reason: r.user_reason || '',
    excerpt: String(r.selection || r.extracted_text || '').slice(0, 320),
    has_shot: Boolean(r.has_shot),
    loose: true,
  }));
}

function parseCited(answer, refs) {
  const ids = new Set();
  for (const m of String(answer).matchAll(/\[(\d+)\]/g)) {
    const ref = refs[Number(m[1]) - 1];
    if (ref) ids.add(ref.id);
  }
  return [...ids];
}

function asText(out) {
  if (typeof out === 'string') return out;
  if (out && typeof out === 'object') {
    for (const k of ['answer', 'text', 'content', 'response', 'message']) {
      if (typeof out[k] === 'string' && out[k].trim()) return out[k];
    }
    const first = Object.values(out).find((v) => typeof v === 'string' && v.trim());
    if (first) return first;
  }
  return 'I could not shape an answer from these references — try rephrasing the question.';
}

const MEM_PATTERNS = [
  { re: /(?:call me|my name is)\s+([A-Za-z][A-Za-z .'-]{1,60})/i, layer: 'permanent', key: 'name', label: 'name' },
  { re: /my email is\s+(\S+@\S+\.\S+)/i, layer: 'permanent', key: 'email', label: 'email' },
  { re: /i (?:am a|work as an?)\s+([a-z][a-z .&/-]{2,60})/i, layer: 'occupational', key: 'role', label: 'role' },
  { re: /(?:i am |i'm )?working on\s+(.{3,120})/i, layer: 'dynamic', key: 'current_project', label: 'project' },
  { re: /my (?:current )?project is\s+(.{3,120})/i, layer: 'dynamic', key: 'current_project', label: 'project' },
];

function cleanVal(s) {
  return String(s || '').trim().replace(/[.\s]+$/, '').slice(0, 120);
}

/** Fast-path memory writes: "call me X" updates user memory before the answer. */
export function extractMemoryWrites(spaceId, query) {
  const writes = [];
  for (const p of MEM_PATTERNS) {
    const m = String(query).match(p.re);
    if (!m) continue;
    const value = cleanVal(m[1]);
    if (!value) continue;
    putMemoryRow(spaceId, p.layer, p.key, value, 95);
    writes.push({ layer: p.layer, key: p.key, label: p.label, value });
  }
  return writes;
}

function priorThreads(spaceId, convId, n = 8) {
  return listConversations(spaceId, n + 1)
    .filter((c) => c.id !== convId)
    .slice(0, n)
    .map((c) => ({ id: c.id, title: c.title || 'Untitled thread', created_at: c.created_at }));
}

function mockThink(query, refs, mode, priorCount, extra = {}) {
  const follow = priorCount > 0 ? `Following up (${priorCount} earlier messages). ` : '';
  const nameWrite = (extra.memWrites || []).find((w) => w.key === 'name');
  if (nameWrite) return `${follow}Got it — I'll call you ${nameWrite.value} from now on. (mock read)`;
  if (/what('s| is) my name|who am i\b|my name\?/i.test(query) && extra.memName) {
    return `${follow}Your name is ${extra.memName} — that's what I'll call you. (mock read)`;
  }
  if (/prior chat|previous (chat|conversation|thread)|last time|what did we (discuss|talk)/i.test(query) && extra.priors && extra.priors.length) {
    return `${follow}Previously you explored: ${extra.priors.map((p) => `"${p.title}"`).join(', ')}. (mock read)`;
  }
  if (!refs.length) {
    return `${follow}Hey, I have no saved references to work from yet.\n\nTell me a topic or link you want to keep.\nI will save it as your first spark.\nThen ask me to use it.\n\nWhat else works right now: tell me your name and I'll remember you, or ask about an earlier chat. (mock read)`;
  }
  const lines = refs.map(
    (r) => `[${r.n}] ${r.title} — ${r.reason ? `"${r.reason.slice(0, 100)}"` : r.excerpt.slice(0, 100)}`
  );
  const deep =
    mode === 'deep'
      ? `\n\nComparing them: [1] sets the tone while [${refs.length}] sets the pace. The tension worth resolving is warmth versus utility — pick one as the lead and let the other support it.`
      : '';
  return `${follow}Here's what your ${refs.length} reference${refs.length > 1 ? 's' : ''} suggest for "${String(query).slice(0, 80)}":\n\n${lines.join('\n')}\n\nThe thread connecting them: start from [1] and steal one idea from [${refs.length}].${deep} (mock read)`;
}

function buildInput({ query, history, refs, priors, loose }) {
  const parts = [`Question: ${query}`];
  if (history) parts.push(`Conversation so far:\n${history}`);
  if (priors && priors.length) {
    parts.push(
      `Previous conversations (same person, earlier threads — use for "what did we discuss" questions):\n${priors.map((p) => `- "${p.title}" (${String(p.created_at).slice(0, 10)})`).join('\n')}`
    );
  }
  parts.push(
    refs.length
      ? `${loose ? 'Weakly-related references (thin link — cite cautiously, verify first)' : 'References'}:\n${refs
          .map((r) => `[${r.n}] ${r.title} (${r.host})\nIntention: ${r.reason || '—'}\nExcerpt: ${r.excerpt || '—'}`)
          .join('\n\n')}`
      : '(No saved references at all — say what is missing, then say what ELSE can be done: what to save, what to search, or which question to ask instead.)'
  );
  return parts.join('\n\n');
}

/** Shared prep: thread, history, retrieval, memory, prompt. Fast and local. */
export function prepareThink({ spaceId, query, conversationId = null, projectSlug = '', pinIds = [], mode = 'quick' }) {
  const t0 = Date.now();
  const deep = mode === 'deep';
  let convId = conversationId;
  if (!convId || !getThread(convId)) convId = createConversation(spaceId, String(query).slice(0, 60));
  addMessage(convId, 'user', query, []);
  const prior = getThread(convId).messages.slice(0, -1);
  const history = prior
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'You' : 'Tweaks'}: ${String(m.content).slice(0, 500)}`)
    .join('\n');
  let refs = retrieve(spaceId, query, { limit: deep ? 10 : 6, projectSlug, pinIds });
  // Refresh pass: exact search found nothing and nothing was pinned — retry loose.
  let loose = false;
  if (!refs.length && !(pinIds && pinIds.length)) {
    refs = retrieveLoose(spaceId, query, { limit: deep ? 5 : 3 });
    loose = refs.length > 0;
  }
  // Memory writes land BEFORE the block is built, so this same answer sees them.
  const memWrites = extractMemoryWrites(spaceId, query);
  const priors = priorThreads(spaceId, convId);
  const memoryRows = getMemoryRows(spaceId);
  const memNameRow = memoryRows.find((r) => r.layer === 'permanent' && r.key === 'name');
  const memName = memNameRow ? String(memNameRow.value) : '';
  const interests = [
    ...topStats(spaceId, 'knowledge_type', 8),
    ...topStats(spaceId, 'aesthetic', 8),
    ...topStats(spaceId, 'intent', 8),
  ]
    .sort((a, b) => b.saves_count - a.saves_count)
    .slice(0, 5);
  const block = buildMemoryBlock(memoryRows, interests);
  const system = `${THINK_SYSTEM}${deep ? `\n\n${DEEP_SUFFIX}` : ''}\n\nUser memory:\n${block || '(none yet)'}`;
  const input = buildInput({ query, history, refs, priors, loose });
  return {
    convId, refs, system, input, model: thinkModel(deep), deep,
    priorCount: prior.length, retrieveMs: Date.now() - t0,
    memWrites, priors, memName,
  };
}

async function completeThink(prep, args) {
  const t1 = Date.now();
  let answer;
  let usage;
  if (process.env.AI_PROVIDER === 'real') {
    const { result, usage: u } = await chatJSON({ model: prep.model, system: prep.system, userText: prep.input, json: false });
    answer = asText(result);
    usage = u;
  } else {
    answer = mockThink(args.query, prep.refs, prep.deep ? 'deep' : 'quick', prep.priorCount, {
      memWrites: prep.memWrites, priors: prep.priors, memName: prep.memName,
    });
    usage = { in: estTokens(prep.input), out: estTokens(answer), estimated: true };
  }
  const logModel = process.env.AI_PROVIDER === 'real' ? prep.model : `${prep.model} (mock)`;
  const userId = args.userId || 'local-user';
  const cited = persistAnswer(prep.convId, answer, prep.refs, usage, { spaceId: args.spaceId, userId, model: logModel });
  return {
    conversationId: prep.convId, answer, refs: prep.refs, cited,
    mode: prep.deep ? 'deep' : 'quick', usage, memWrites: prep.memWrites,
    timings: { retrieveMs: prep.retrieveMs, aiMs: Date.now() - t1 },
  };
}

function persistAnswer(convId, answer, refs, usage, meta) {
  const cited = parseCited(answer, refs);
  // Store the per-answer ref snapshot so [n] chips resolve forever, even
  // after later answers in the thread use a different ref list.
  addMessage(convId, 'assistant', answer, cited, refs.map((r) => r.id));
  logUsage({ spaceId: meta.spaceId, userId: meta.userId, kind: 'think', model: meta.model, inTokens: usage.in, outTokens: usage.out });
  return cited;
}

export async function runThink(args) {
  return completeThink(prepareThink(args), args);
}

function replay(send, text) {
  const words = String(text || '').split(/(\s+)/);
  let buf = '';
  for (const w of words) {
    buf += w;
    if (buf.length > 40) {
      send({ t: 'tok', s: buf });
      buf = '';
    }
  }
  if (buf) send({ t: 'tok', s: buf });
}

/** Quick: true token streaming. Deep+real: tool loop with live status, then
    chunked replay (rounds are non-streaming). Mock/failure: chunked replay. */
export async function streamThink(controller, args) {
  const enc = new TextEncoder();
  const send = (o) => controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
  const prep = prepareThink(args);
  send({ t: 'refs', refs: prep.refs });
  if (prep.memWrites.length) send({ t: 'mem', mem: prep.memWrites });
  const t1 = Date.now();
  const userId = args.userId || 'local-user';
  if (process.env.AI_PROVIDER === 'real') {
    try {
      if (prep.deep) {
        const ctx = createToolContext(args.spaceId, prep.refs);
        const { text } = await runToolLoop({
          model: prep.model,
          system: `${prep.system}\n\n${TOOL_GUIDE}`,
          userText: prep.input,
          toolDefs: TOOL_DEFS,
          runTool: (name, a) => runTool(ctx, name, a),
          maxRounds: 3,
          onTool: (name) => send({ t: 'tool', name }),
          onUsage: (u) =>
            logUsage({ spaceId: args.spaceId, userId, kind: 'think', model: prep.model, inTokens: u.in, outTokens: u.out }),
        });
        // Final refs follow the shared numbering (initial + tool-found, deduped).
        const finalRefs = getRefCards(ctx.order);
        replay(send, text);
        const cited = parseCited(text, finalRefs);
        addMessage(prep.convId, 'assistant', text, cited, finalRefs.map((r) => r.id));
        send({ t: 'refs', refs: finalRefs });
        send({ t: 'done', conversationId: prep.convId, refs: finalRefs, cited, mem: prep.memWrites, timings: { retrieveMs: prep.retrieveMs, aiMs: Date.now() - t1 } });
        controller.close();
        return;
      }
      let full = '';
      const { text, usage } = await chatStream({
        model: prep.model,
        system: prep.system,
        userText: prep.input,
        onToken: (delta) => {
          full += delta;
          send({ t: 'tok', s: delta });
        },
      });
      const cited = persistAnswer(prep.convId, full, prep.refs, usage, { spaceId: args.spaceId, userId, model: prep.model });
      send({ t: 'done', conversationId: prep.convId, refs: prep.refs, cited, mem: prep.memWrites, timings: { retrieveMs: prep.retrieveMs, aiMs: Date.now() - t1 } });
      controller.close();
      return;
    } catch {
      // Fall through to a full non-stream attempt below.
    }
  }
  const result = await completeThink(prep, args);
  replay(send, result.answer);
  // NOTE: fallback path re-runs prepare (duplicate user message). Acceptable
  // rarity: only when true streaming fails. A queue would dedupe this.
  send({ t: 'done', conversationId: result.conversationId, refs: result.refs, cited: result.cited, mem: result.memWrites, timings: result.timings });
  controller.close();
}
