'use strict';

/**
 * Visual trigger for Thing 1 §11. Pure, no deps.
 * Decides whether a save gets visual.metadata and at which depth.
 */

const VISUAL_KEYWORDS = [
  'design', 'layout', 'font', 'typography', 'typeface', 'aesthetic',
  'look', 'feel', 'style', 'vibe', 'color', 'colour', 'palette',
  'minimal', 'visual', 'screenshot', ' ui', 'ux', 'theme', 'mood',
  'inspiration', 'reference', 'beautiful', 'pretty', 'elegant',
];

const DEEP_TYPES = ['image', 'region', 'design_reference', 'effect'];

function isVisualIntent(reason) {
  if (!reason) return false;
  const r = ` ${reason.toLowerCase()} `;
  return VISUAL_KEYWORDS.some((k) => r.includes(k.toLowerCase()));
}

/**
 * Returns { depth: 'none'|'basic'|'deep', trigger }.
 * Server may upgrade basic→deep when knowledge_type winner is design ≥ 40.
 */
function visualDepth({ saveType, reason, hasScreenshot }) {
  if (DEEP_TYPES.includes(saveType)) return { depth: 'deep', trigger: 'save_type' };
  if (isVisualIntent(reason)) return { depth: 'deep', trigger: 'visual_keyword' };
  if (hasScreenshot) return { depth: 'basic', trigger: 'screenshot' };
  return { depth: 'none', trigger: 'screenshot' };
}

module.exports = { VISUAL_KEYWORDS, DEEP_TYPES, isVisualIntent, visualDepth };
