'use strict';

/**
 * Pure classifier helpers for Thing 1. No I/O, no deps — safe to unit test.
 * LLM call itself lives in the API route (provider SDK), these shape its input/output.
 */

const SETS = ['intent', 'future_action', 'knowledge_type', 'time_orientation', 'motivation'];

function trunc(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) : s;
}

/** Build the §4 classifier input block. Keeps total under ~6k chars. */
function buildClassifierInput({ title, url, reason, pageText, ocrText, savesToday, folders, projects, memoryBlock }) {
  return [
    ...(memoryBlock ? [`Memory:\n${memoryBlock}`] : []),
    `Title: ${title || '(untitled)'}`,
    `URL: ${url || ''}`,
    `User reason: ${reason || '(no reason given)'}`,
    `Page text (truncated): ${trunc(pageText, 4000)}`,
    `OCR text (truncated): ${trunc(ocrText, 1500)}`,
    `Context: saves_today=${savesToday || 0}, existing_folders=[${(folders || []).join(', ')}], existing_projects=[${(projects || []).join(', ')}]`,
  ].join('\n');
}

/** Pick top-1 winner per set. Ties → first in taxonomy order (input order) wins. */
function pickWinners(classification, taxonomy) {
  const winners = {};
  for (const set of SETS) {
    const order = new Map((taxonomy[set] || []).map((l, i) => [l, i]));
    const rows = [...(classification[set] || [])].sort(
      (a, b) => b.score - a.score || (order.get(a.label) ?? 99) - (order.get(b.label) ?? 99)
    );
    winners[set] = { label: rows[0].label, score: rows[0].score };
  }
  return winners;
}

/** Validate each set sums to 100. Returns list of offending sets (empty = valid). */
function validateSums(classification) {
  return SETS.filter((set) => {
    const sum = (classification[set] || []).reduce((n, r) => n + r.score, 0);
    return sum !== 100;
  });
}

/** Deterministic fallback: scale scores to sum 100 (largest remainder), keep order. */
function normalizeSets(classification) {
  const out = { ...classification };
  for (const set of SETS) {
    const rows = classification[set] || [];
    const sum = rows.reduce((n, r) => n + r.score, 0);
    if (sum === 100 || sum === 0) continue;
    const scaled = rows.map((r) => (r.score * 100) / sum);
    const floored = scaled.map(Math.floor);
    let rest = 100 - floored.reduce((n, x) => n + x, 0);
    const order = scaled
      .map((v, i) => [v - Math.floor(v), i])
      .sort((a, b) => b[0] - a[0])
      .map(([, i]) => i);
    for (const i of order) {
      if (rest <= 0) break;
      floored[i] += 1;
      rest -= 1;
    }
    out[set] = rows.map((r, i) => ({ label: r.label, score: floored[i] }));
  }
  return out;
}

module.exports = { SETS, buildClassifierInput, pickWinners, validateSums, normalizeSets };
