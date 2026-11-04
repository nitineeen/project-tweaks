import fs from 'node:fs';
import path from 'node:path';
import { normalizeSets, validateSums } from './classify.js';

/**
 * AI providers. AI_PROVIDER=mock (deterministic fixtures, no network) or
 * real (OpenAI-compatible POST {base}/chat/completions).
 *
 * Token counting: gateway `usage` when present, else chars/4 estimate
 * (+1500 in-tokens per attached image for vision). Estimates are marked.
 */

function loadPrompt(name) {
  try {
    return fs.readFileSync(path.resolve(process.cwd(), `../../packages/shared/prompts/${name}`), 'utf8');
  } catch {
    return '';
  }
}

let _cp = null;
let _vp = null;
export function classifyPrompt() {
  if (_cp === null) _cp = loadPrompt('classify-v1.md');
  return _cp;
}
export function visualPrompt() {
  if (_vp === null) _vp = loadPrompt('visual-v1.md');
  return _vp;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function trunc(s, n) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n) : t;
}

export function estTokens(s) {
  return Math.ceil(String(s || '').length / 4);
}

export function mockClassify({ reason = '', title = '', url = '' }, taxonomy) {
  const h = hash(`${title}|${reason}|${url}`);
  const out = {};
  Object.keys(taxonomy).forEach((set, si) => {
    out[set] = taxonomy[set].map((label, i) => {
      let w = ((h + i * 53 + si * 97) % 55) + 5;
      if (set === 'knowledge_type' && label === 'design' && /design|layout|font|aesthetic|vibe|style/i.test(reason)) w += 45;
      if (set === 'intent' && label === 'research' && /research|study|learn/i.test(`${reason} ${title}`)) w += 35;
      if (set === 'motivation' && label === 'curiosity' && !reason) w += 25;
      return { label, score: w };
    });
    // Mock should demo the happy path: make each set's leader decisive.
    let best = 0;
    out[set].forEach((r, i) => {
      if (r.score > out[set][best].score) best = i;
    });
    out[set][best].score += 80;
  });
  if (/font|typeface|typograph/i.test(`${reason} ${title}`)) {
    out.knowledge_type.push({ label: 'typography', score: 40, proposed: true });
  }
  const fixed = normalizeSets({ ...out, ai_explanation: '' });
  fixed.ai_explanation = reason
    ? `You saved this because you noted: "${trunc(reason, 140)}" (mock read)`
    : `You saved this because "${trunc(title || url, 80)}" looked worth keeping. (mock read)`;
  return fixed;
}

export function mockVisual({ depth = 'basic', trigger = 'screenshot', title = '' }) {
  if (depth === 'none') return { image_count: 0, regions: [], aesthetics: [], trigger, status: 'ok' };
  const base = {
    image_count: 1,
    regions: [
      {
        id: 'r1', label: 'hero area', bbox: null, contains_images: 1,
        description: trunc(`Main visual on ${title || 'this page'}.`, 200),
        labels: ['screenshot', 'web', 'reference'],
      },
    ],
    aesthetics: ['warm-minimalism'],
    trigger,
    status: 'ok',
  };
  if (depth === 'deep') {
    base.fonts = { styles: ['sans body'] };
    base.design = { layout: 'single column, generous whitespace', notes: 'mock read — connect real vision for detail' };
    base.overall_design_idea =
      'Mock design read: calm, content-first layout. Connect the vision model for a real analysis.';
  }
  return base;
}

function extractJSON(s) {
  if (typeof s !== 'string') return null;
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch {
    return null;
  }
}

function gateway() {
  const base = (process.env.AI_API_BASE || '').replace(/\/$/, '');
  const key = process.env.AI_API_KEY || '';
  if (!base || !key) throw new Error('AI_API_BASE/AI_API_KEY not set');
  return { base, key };
}

function usageFrom(data, fallbackIn, fallbackOut) {
  const u = data && data.usage;
  if (u && Number.isFinite(u.prompt_tokens) && Number.isFinite(u.completion_tokens)) {
    return { in: u.prompt_tokens, out: u.completion_tokens, estimated: false };
  }
  return { in: fallbackIn, out: fallbackOut, estimated: true };
}

/** Non-streaming call. Returns { result, usage }. */
export async function chatJSON({ model, system, userText, imageDataUrl, json = true }) {
  const { base, key } = gateway();
  const messages = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: imageDataUrl
        ? [{ type: 'text', text: userText }, { type: 'image_url', image_url: { url: imageDataUrl } }]
        : userText,
    },
  ];
  const estIn = estTokens(system) + estTokens(userText) + (imageDataUrl ? 1500 : 0);
  let lastErr = '';
  // json=true: structured calls (classify/vision) — try json_object, fall back to repair.
  // json=false: prose calls (think) — raw text, never parsed as JSON.
  for (const withFormat of json ? [true, false] : [false]) {
    try {
      const body = { model, messages };
      if (withFormat) body.response_format = { type: 'json_object' };
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90000),
      });
      if (!res.ok) {
        lastErr = `http ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`;
        continue;
      }
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      const usage = usageFrom(data, estIn, estTokens(content));
      if (!json) {
        if (typeof content === 'string' && content.trim()) return { result: content, usage };
        lastErr = 'empty reply';
        continue;
      }
      const parsed = extractJSON(content);
      if (parsed) return { result: parsed, usage };
      lastErr = 'no JSON in response';
    } catch (e) {
      lastErr = String((e && e.message) || e).slice(0, 200);
    }
  }
  throw new Error(`AI call failed (${model}): ${lastErr}`);
}

/** Tool-call round. Returns { content, toolCalls: [{ id, name, args }], usage }. */
export async function chatTools({ model, messages, tools, toolChoice = 'auto' }) {
  const { base, key } = gateway();
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, tools, tool_choice: toolChoice }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) {
    throw new Error(`tools call failed: http ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  const data = await res.json();
  const msg = data?.choices?.[0]?.message || {};
  const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
  const estIn = estTokens(JSON.stringify(messages).slice(0, 20000));
  return {
    content: typeof msg.content === 'string' ? msg.content : '',
    toolCalls: calls.map((c) => {
      let args = {};
      try {
        args = JSON.parse(c?.function?.arguments || '{}');
      } catch {
        args = {};
      }
      return { id: c?.id || '', name: c?.function?.name || '', args };
    }),
    usage: usageFrom(data, estIn, estTokens(msg.content || '')),
  };
}

/** True token streaming. Calls onToken(delta) per chunk. Returns { text, usage }. */
export async function chatStream({ model, system, userText, onToken }) {
  const { base, key } = gateway();
  const estIn = estTokens(system) + estTokens(userText);
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userText },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok || !res.body) {
    throw new Error(`stream failed: http ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  let usage = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop();
    for (const p of parts) {
      for (const line of p.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const o = JSON.parse(payload);
          const delta = o?.choices?.[0]?.delta?.content;
          if (delta) {
            text += delta;
            if (onToken) onToken(delta);
          }
          if (o?.usage) usage = o.usage;
        } catch {
          /* partial chunk */
        }
      }
    }
  }
  if (!text.trim()) throw new Error('stream produced no text');
  return {
    text,
    usage:
      usage && Number.isFinite(usage.prompt_tokens)
        ? { in: usage.prompt_tokens, out: usage.completion_tokens || estTokens(text), estimated: false }
        : { in: estIn, out: estTokens(text), estimated: true },
  };
}

export async function realTextClassify(input) {
  const model = process.env.MODEL_CLASSIFY || 'muse-spark-1.3';
  const total = { in: 0, out: 0, estimated: false };
  const first = await chatJSON({ model, system: classifyPrompt(), userText: input });
  total.in += first.usage.in;
  total.out += first.usage.out;
  total.estimated = first.usage.estimated;
  let out = first.result;
  if (!out || typeof out !== 'object') throw new Error('classifier returned non-object');
  if (validateSums(out).length) {
    const fix = await chatJSON({
      model,
      system: 'Fix the classification JSON so every set sums to 100. Keep labels and order.',
      userText: JSON.stringify(out),
    });
    total.in += fix.usage.in;
    total.out += fix.usage.out;
    out = fix.result && typeof fix.result === 'object' ? fix.result : out;
    if (validateSums(out).length) out = normalizeSets(out);
  }
  return { out, usage: total };
}

export async function realVisual(input, imageDataUrl) {
  const model = process.env.MODEL_VISION || 'muse-spark-1.3';
  const { result, usage } = await chatJSON({ model, system: visualPrompt(), userText: input, imageDataUrl });
  return { out: result, usage };
}
