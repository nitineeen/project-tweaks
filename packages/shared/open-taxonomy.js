'use strict';

/**
 * Open taxonomy merge for Thing 1 §5. Pure, no deps.
 * Seeds + AI proposals in → one canonical scored set out.
 * Duplicates fold into the canonical row; genuinely new labels register.
 */

const MAX_PROPOSED_PER_SET = 2;
const MAX_CUSTOM_PER_SET = 40;

function normalizeLabel(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * classification: raw model output ({ [set]: [{label, score, proposed?}], ... })
 * taxonomy: seeds ({ [set]: string[] })
 * known: already-registered customs ({ [set]: string[] }) from taxonomy_stats
 * Returns { merged, added: [{set,label}], duplicates: [{set,label,foldedInto}] }.
 */
function partitionAndMerge(classification, taxonomy, known) {
  const merged = { ai_explanation: classification.ai_explanation || '' };
  const added = [];
  const duplicates = [];
  for (const set of Object.keys(taxonomy)) {
    const rows = Array.isArray(classification[set]) ? classification[set] : [];
    const seeds = new Set((taxonomy[set] || []).map(normalizeLabel));
    const knownSet = new Set([...(known[set] || []).map(normalizeLabel), ...seeds]);
    let customs = [...knownSet].filter((l) => l && !seeds.has(l)).length;
    const acc = new Map();
    const customsRows = [];
    for (const r of rows) {
      const canon = normalizeLabel(r.label);
      if (!canon) continue;
      if (seeds.has(canon)) {
        acc.set(canon, (acc.get(canon) || 0) + r.score);
        if (r.proposed) duplicates.push({ set, label: String(r.label), foldedInto: canon });
      }
      else customsRows.push({ canon, raw: String(r.label), score: r.score, proposed: Boolean(r.proposed) });
    }
    const flagged = customsRows.filter((c) => c.proposed).slice(0, MAX_PROPOSED_PER_SET);
    const unflagged = customsRows.filter((c) => !c.proposed);
    for (const c of [...flagged, ...unflagged]) {
      if (knownSet.has(c.canon) || acc.has(c.canon)) {
        acc.set(c.canon, (acc.get(c.canon) || 0) + c.score);
        duplicates.push({ set, label: c.raw, foldedInto: c.canon });
      } else if (customs >= MAX_CUSTOM_PER_SET) {
        duplicates.push({ set, label: c.raw, foldedInto: '(capped: dropped)' });
      } else {
        acc.set(c.canon, c.score);
        knownSet.add(c.canon);
        customs += 1;
        added.push({ set, label: c.canon });
      }
    }
    merged[set] = [...acc.entries()].map(([label, score]) => ({ label, score }));
  }
  return { merged, added, duplicates };
}

module.exports = { MAX_PROPOSED_PER_SET, MAX_CUSTOM_PER_SET, normalizeLabel, partitionAndMerge };
