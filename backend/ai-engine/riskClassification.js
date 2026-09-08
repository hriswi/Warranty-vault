/**
 * riskClassification.js
 *
 * SINGLE canonical source of truth for risk level classification.
 *
 * Every consumer of a risk score — the risk engine itself, dashboards,
 * product pages, monitors, the knowledge graph — must derive level,
 * label, recommendation and color from THIS module. Nothing else may map
 * a score to a level, so the score, level, label and color can never
 * disagree.
 *
 * The risk EXPLANATION is NOT level-based: it is built dynamically from
 * the actual risk factors by the engine (riskReason.js). There is no
 * generic per-level "description" text anymore, so the UI can never show
 * a canned sentence like "expired coverage" for a product whose warranty
 * is active.
 *
 * Bands (deterministic, engine-calibrated):
 *   <25  LOW       (well-covered, no red flags)
 *   25-49 MEDIUM   (moderate exposure — monitor + file claims in time)
 *   50-74 HIGH     (expired coverage / suspicious document / weak data)
 *   75+  CRITICAL  (expired coverage PLUS recall evidence, or very low
 *                   extraction confidence, or strong fraud signals)
 */

export const RISK_LEVEL_DEFS = Object.freeze([
  {
    level: 'CRITICAL',
    min: 75,
    label: 'Critical',
    recommendation: 'Treat this product as high risk — resolve the flagged concerns before relying on warranty support.',
    color: 'rgba(255,255,255,0.9)',
  },
  {
    level: 'HIGH',
    min: 50,
    label: 'High',
    recommendation: 'Verify coverage, service history and document integrity before relying on warranty support.',
    color: 'rgba(255,255,255,0.65)',
  },
  {
    level: 'MEDIUM',
    min: 25,
    label: 'Medium',
    recommendation: 'Monitor the product and file any claims before the warranty expires.',
    color: 'rgba(255,255,255,0.4)',
  },
  {
    level: 'LOW',
    min: 0,
    label: 'Low',
    recommendation: 'Routine maintenance only — no action required.',
    color: 'rgba(255,255,255,0.22)',
  },
]);

export const RISK_LEVELS = Object.freeze(RISK_LEVEL_DEFS.map((d) => d.level));

/**
 * Maps a score to its level definition. Scores are clamped to 0-100.
 * Returns null for null/NaN scores (use INSUFFICIENT_DATA elsewhere).
 */
export function classifyRiskLevel(score) {
  if (score == null || !Number.isFinite(Number(score))) return null;
  const s = Math.max(0, Math.min(100, Number(score)));
  return RISK_LEVEL_DEFS.find((d) => s >= d.min) || RISK_LEVEL_DEFS[RISK_LEVEL_DEFS.length - 1];
}

export function riskLevelFor(score) {
  const c = classifyRiskLevel(score);
  return c ? c.level : null;
}

export function riskLevelLabelFor(score) {
  const c = classifyRiskLevel(score);
  return c ? c.label : null;
}

/**
 * Actionable recommendation keyed by LEVEL. This is ADVICE, never an
 * explanation — the risk explanation comes from the engine's dynamic
 * riskReason (riskReason.js), which is built from the actual factors.
 */
export function riskRecommendationFor(level) {
  const c = RISK_LEVEL_DEFS.find((d) => d.level === level);
  return c ? c.recommendation : null;
}

export function riskColorFor(score) {
  const c = classifyRiskLevel(score);
  return c ? c.color : 'rgba(255,255,255,0.25)';
}

export default { RISK_LEVEL_DEFS, RISK_LEVELS, classifyRiskLevel, riskLevelFor, riskLevelLabelFor, riskRecommendationFor, riskColorFor };
