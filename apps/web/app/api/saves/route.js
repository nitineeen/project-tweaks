import fs from 'node:fs';
import path from 'node:path';
import { spaceFromRequest } from '@/lib/auth';
import {
  getDb, insertSave, updateSave, listSaves,
  getKnownLabels, upsertTaxonomyStats, getMemoryRows, topStats,
  logUsage, checkBudget,
} from '@/lib/db';
import { SETS, buildClassifierInput, pickWinners, normalizeSets } from '@/lib/classify';
import { partitionAndMerge } from '../../../../../packages/shared/open-taxonomy.js';
import { metaLabel, folderForMeta } from '../../../../../packages/shared/meta-label.js';
import { buildMemoryBlock } from '../../../../../packages/shared/memory.js';
import { visualDepth } from '../../../../../packages/shared/visual.js';
import { mockClassify, mockVisual, realTextClassify, realVisual, estTokens } from '@/lib/ai';
import { enrichLink } from '@/lib/enrich';
import taxonomy from '../../../../../packages/shared/taxonomy.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function canonicalize(raw) {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) {
      if (k.startsWith('utm_')) u.searchParams.delete(k);
    }
    u.hash = '';
    return u.toString();
  } catch {
    return raw || '';
  }
}

function dayParts(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return {
    date_saved: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time_saved: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
  };
}

export async function GET(req) {
  const auth = spaceFromRequest(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: 401 });
  const params = new URL(req.url).searchParams;
  getDb();
  return Response.json({
    saves: listSaves({
      limit: params.get('limit') ? Number(params.get('limit')) : 20,
      type: params.get('type') || '',
      project: params.get('project') || '',
    }),
  });
}

export async function POST(req) {
  const auth = spaceFromRequest(req);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: 401 });

  let meta;
  try {
    const form = await req.formData();
    meta = JSON.parse(form.get('metadata'));
    var shot = form.get('screenshot'); // File | null
  } catch {
    return Response.json({ error: 'bad multipart body (need metadata JSON)' }, { status: 400 });
  }
  if (!meta || !meta.original_url) {
    return Response.json({ error: 'metadata.original_url required' }, { status: 400 });
  }

  // Pasted links arrive bare — enrich title/text/thumbnail server-side.
  if ((meta.save_type || '') === 'link') {
    try {
      const e = await enrichLink(meta.original_url);
      if (e.title) meta.page_title = e.title;
      if (e.text) meta.extracted_text = e.text;
      if (e.image_url) meta.image_url = e.image_url;
      if (e.isVideo) meta.save_type = 'video';
    } catch {
      /* keep the raw link */
    }
  }

  let shotPath = null;
  let shotDataUrl = null;
  if (shot && typeof shot.arrayBuffer === 'function') {
    try {
      const buf = Buffer.from(await shot.arrayBuffer());
      if (buf.length > 0 && buf.length < 8_000_000) {
        const dir = path.resolve(process.cwd(), './.local/shots');
        fs.mkdirSync(dir, { recursive: true });
        const name = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}.jpg`;
        shotPath = path.join(dir, name);
        fs.writeFileSync(shotPath, buf);
        shotDataUrl = `data:${shot.type || 'image/jpeg'};base64,${buf.toString('base64')}`;
      }
    } catch {
      shotPath = null;
      shotDataUrl = null;
    }
  }

  getDb();
  const id = insertSave({
    space_id: auth.spaceId,
    user_id: auth.userId,
    original_url: meta.original_url,
    canonical_url: canonicalize(meta.original_url),
    page_title: meta.page_title || '',
    extracted_text: meta.extracted_text || '',
    ocr_text: meta.ocr_text || '',
    screenshot_path: shotPath,
    ...dayParts(),
    tz: meta.tz || 'UTC',
    user_reason: (meta.user_reason || '').slice(0, 500),
    save_type: meta.save_type || 'page',
    selection: (meta.selection || '').slice(0, 4000),
    image_url: meta.image_url || null,
    status: 'classifying',
  });

  // Budget gate: the save is already stored, but AI filing costs money.
  const budget = checkBudget(auth.userId);
  if (!budget.ok) {
    const msg =
      budget.reason === 'banned'
        ? 'Account blocked — contact your admin.'
        : budget.reason === 'nouser'
          ? 'Unknown user — contact your admin.'
          : 'Usage limit reached — upgrade to keep filing.';
    updateSave(id, { status: 'needs_review', ai_explanation: msg });
    return Response.json({ id, status: 'needs_review', blocked: budget.reason });
  }

  // Local simplification vs the 202 sketch: classify inline and return the
  // filed row. The extension already treats 2xx as sent; status endpoint
  // stays for polling. A queue replaces this in production.
  try {
    const result = await classifyAndFile({
      id, spaceId: auth.spaceId, userId: auth.userId, meta, shotDataUrl, hasShot: Boolean(shotPath),
    });
    return Response.json({ id, ...result });
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 300);
    updateSave(id, { status: 'needs_review', ai_explanation: `Filing failed, saved anyway: ${msg}` });
    return Response.json({ id, status: 'needs_review', error: msg });
  }
}

async function classifyAndFile({ id, spaceId, userId, meta, shotDataUrl, hasShot }) {
  const reason = meta.user_reason || '';
  const title = meta.page_title || '';
  const saveType = meta.save_type || 'page';

  const [memoryRows, kStats, aStats, iStats] = [
    getMemoryRows(spaceId),
    topStats(spaceId, 'knowledge_type', 8),
    topStats(spaceId, 'aesthetic', 8),
    topStats(spaceId, 'intent', 8),
  ];
  const interests = [...kStats, ...aStats, ...iStats]
    .sort((a, b) => b.saves_count - a.saves_count)
    .slice(0, 5);
  const memoryBlock = buildMemoryBlock(memoryRows, interests);

  const input = buildClassifierInput({
    title, url: meta.original_url, reason,
    pageText: meta.extracted_text, ocrText: meta.ocr_text,
    memoryBlock: memoryBlock || undefined,
  });
  const { depth, trigger } = visualDepth({ saveType, reason, hasScreenshot: hasShot });
  const useReal = process.env.AI_PROVIDER === 'real';

  let textOut;
  let visualOut;
  const modelC = process.env.MODEL_CLASSIFY || 'muse-spark-1.3';
  const modelV = process.env.MODEL_VISION || 'muse-spark-1.3';
  const noUsage = { in: 0, out: 0, estimated: false };
  if (useReal) {
    // Parallel calls, never in series (§11).
    const [t, v] = await Promise.all([
      realTextClassify(input),
      depth === 'none'
        ? Promise.resolve({ out: { image_count: 0, regions: [], aesthetics: [], trigger, status: 'ok' }, usage: noUsage })
        : realVisual(`depth: ${depth}\nTitle: ${title}\nURL: ${meta.original_url}`, shotDataUrl).catch((e) => ({
          out: { status: 'failed', trigger, error: String((e && e.message) || e).slice(0, 200) },
          usage: noUsage,
        })),
    ]);
    textOut = t.out;
    visualOut = v.out;
    logUsage({ spaceId, userId, kind: 'classify', model: modelC, inTokens: t.usage.in, outTokens: t.usage.out });
    if (depth !== 'none' && visualOut.status !== 'failed') {
      logUsage({ spaceId, userId, kind: 'vision', model: modelV, inTokens: v.usage.in, outTokens: v.usage.out });
    }
  } else {
    textOut = mockClassify({ reason, title, url: meta.original_url }, taxonomy);
    visualOut = mockVisual({ depth, trigger, title });
    logUsage({ spaceId, userId, kind: 'classify', model: `${modelC} (mock)`, inTokens: estTokens(input), outTokens: estTokens(JSON.stringify(textOut)) });
    if (depth !== 'none') {
      logUsage({ spaceId, userId, kind: 'vision', model: `${modelV} (mock)`, inTokens: estTokens(title) + (hasShot ? 1500 : 0), outTokens: estTokens(JSON.stringify(visualOut)) });
    }
  }

  const known = getKnownLabels(spaceId);
  const { merged, added } = partitionAndMerge(textOut, taxonomy, known);
  const fixed = normalizeSets(merged);
  for (const s of SETS) {
    if (!fixed[s] || !fixed[s].length) throw new Error(`classifier returned empty set: ${s}`);
  }
  const winners = pickWinners(fixed, taxonomy);
  const m = metaLabel(winners);
  const folder = folderForMeta(m.l2, winners.knowledge_type.label, m.confidence);
  upsertTaxonomyStats(spaceId, winners, added, visualOut);

  const status = m.needsReview ? 'needs_review' : 'filed';
  updateSave(id, {
    classifications: JSON.stringify(fixed),
    winners: JSON.stringify(winners),
    top_signals: JSON.stringify(m.topSignals),
    meta_l1: m.l1, meta_l2: m.l2, meta_l3: m.l3, meta_confidence: m.confidence,
    visual_metadata: JSON.stringify(visualOut || {}),
    folder_slug: folder,
    ai_explanation: String(textOut.ai_explanation || '').slice(0, 500),
    status,
  });
  return { status, meta_l1: m.l1, folder_slug: folder };
}
