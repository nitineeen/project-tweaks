/**
 * Typo-tolerant matching for ⌘K search. Small-scale by design: the candidate
 * pool is hundreds of rows, so application-level scoring beats FTS/trigrams.
 * Optimal string alignment catches transpositions ("clam"→"calm") that plain
 * Levenshtein scores as two edits.
 */

/** Restricted Damerau-Levenshtein (optimal string alignment) distance. */
export function damerau(a, b) {
  a = String(a || '');
  b = String(b || '');
  const n = a.length;
  const m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d = Array.from({ length: n + 1 }, (_, i) => {
    const row = new Array(m + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= m; j += 1) d[0][j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }
  return d[n][m];
}

/** 0..1 word similarity; 1 = identical. */
export function similarity(a, b) {
  const x = String(a || '').toLowerCase();
  const y = String(b || '').toLowerCase();
  const longest = Math.max(x.length, y.length);
  if (!longest) return 1;
  return 1 - damerau(x, y) / longest;
}

export const FUZZY_MIN = 0.62;

function words(s) {
  return String(s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
}

/**
 * Score a multi-word query against a haystack (title + subtitle).
 * Every query word must weakly match (best >= 0.5) and the average must
 * clear FUZZY_MIN — otherwise 0 (no match).
 */
export function fuzzyScore(query, haystack) {
  const qs = words(query);
  const hs = words(haystack);
  if (!qs.length || !hs.length) return 0;
  const hayJoined = hs.join(' ');
  let sum = 0;
  for (const q of qs) {
    if (hayJoined.includes(q)) {
      sum += 1;
      continue;
    }
    let best = 0;
    for (const h of hs) {
      // Skip absurd length gaps early (keeps "a" vs "architecture" honest).
      if (Math.abs(h.length - q.length) > Math.max(2, Math.floor(q.length / 2))) continue;
      const s = similarity(q, h);
      if (s > best) best = s;
      if (best >= 0.95) break;
    }
    if (best < 0.5) return 0;
    sum += best;
  }
  const avg = sum / qs.length;
  return avg >= FUZZY_MIN ? avg : 0;
}
