'use strict';

/**
 * Deterministic meta-label for Tweaks Thing 1.
 * Same winners in → same metas out, forever. No LLM, no randomness.
 *
 * winners: { intent, future_action, knowledge_type, time_orientation, motivation }
 *   each: { label: string, score: number } — labels may be open-taxonomy customs.
 *
 * Returns: { l1, l2, l3, confidence, topSignals, needsReview }
 */

const CODE = {
  // intent
  research: 'res', learning: 'lea', reference: 'ref', inspiration: 'ins', planning: 'pla',
  // future_action
  study_later: 'std', apply: 'app', share: 'shr', discuss: 'dis', archive: 'arc',
  // knowledge_type
  business: 'bus', finance: 'fin', technology: 'tec', design: 'dsg', marketing: 'mkt', other: 'oth',
  // time_orientation
  now: 'now', this_week: 'twk', future_project: 'fut', long_term_ref: 'ltr', fleeting: 'flt',
  // motivation
  curiosity: 'cur', decision_support: 'dec', skill_building: 'skl', social_sharing: 'soc', calm_capture: 'clm',
};

function slug(s) {
  return (
    String(s || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'other'
  );
}

function code(label) {
  const s = slug(label);
  return CODE[s] || s.slice(0, 3);
}

function metaLabel(winners) {
  const intent = slug(winners.intent.label);
  const action = slug(winners.future_action.label);
  const knowledge = slug(winners.knowledge_type.label);
  const time = slug(winners.time_orientation.label);
  const motivation = slug(winners.motivation.label);

  const l1 = `${knowledge}__${intent}`;
  const l2 = `${time}__${action}`;
  const l3 = [intent, knowledge, action, time, motivation].map(code).join('_');

  const scores = [
    winners.intent.score,
    winners.future_action.score,
    winners.knowledge_type.score,
    winners.time_orientation.score,
    winners.motivation.score,
  ];
  const confidence = Math.min(...scores);

  const topSignals = Object.entries(winners)
    .map(([set, w]) => ({ set, label: slug(w.label), score: w.score }))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 3)
    .map((s) => s.label);

  return { l1, l2, l3, confidence, topSignals, needsReview: confidence < 35 };
}

/**
 * Resolve a folder slug from meta + knowledge. Deterministic, overridable later.
 * Thing 1 default for the else-branch is `loose-threads` (embedding centroid comes in P2).
 */
function folderForMeta(l2, knowledge, confidence) {
  const k = slug(knowledge);
  const l = String(l2 || '').toLowerCase();
  if ((l.includes('long_term_ref') || l.includes('fleeting')) && confidence < 50) return 'loose-threads';
  if (k === 'design') return 'visual-language';
  if (k === 'technology' && l.endsWith('__apply')) return 'tools-for-making';
  if (l.startsWith('now__') || l.startsWith('this_week__')) return 'words-worth-keeping';
  return 'loose-threads';
}

module.exports = { slug, metaLabel, folderForMeta };
