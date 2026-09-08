/**
 * riskReason.js
 *
 * Builds the DYNAMIC risk explanation AND recommendation from the ACTUAL
 * evidence the risk engine used. The reason is derived from dominant
 * factors, so it never claims "expired coverage" for an in-warranty
 * product and never mentions invoice/fraud problems for a clean document.
 *
 * Explanation template selection (priority order, combined when multiple):
 *   1. Invoice integrity (suspicious document / synthetic marker)
 *   2. Fraud indicators
 *   3. Warranty expired (or nearly expired) — only when actually true
 *   4. High failure risk (recalls/advisories, age past term)
 *   5. No significant factors -> generic level statement
 *
 * Recommendation template selection (same evidence, actionable wording):
 *   - Suspicious/synthetic invoice -> verify with the seller, do not use
 *     as proof of purchase
 *   - Warranty expired              -> contact manufacturer/seller
 *   - Product failure risk          -> monitor / authorized service
 *   - Multiple factors              -> combined
 * The recommendation is NEVER derived from the level alone, so a Critical
 * score can never produce a canned "professional service advice" message.
 */

const INTEGRITY_THRESHOLD = 25; // risk points that make integrity the dominant story
const RECALL_THRESHOLD = 25;    // risk points from research/reliability evidence
const EXPIRING_SOON_DAYS = 30;  // days within which "expires soon" is mentioned

const INVOICE_RECOMMENDATION =
  'Do not use this invoice as proof of purchase. Verify the original invoice with the seller before relying on the warranty.';
const EXPIRED_WARRANTY_RECOMMENDATION =
  'Warranty coverage has expired. Contact the manufacturer or seller to determine available service options.';
const FAILURE_RISK_RECOMMENDATION =
  'Monitor the product for signs of malfunction and consider authorized service if symptoms appear.';

export function buildRiskReason({
  level,
  label,
  riskFactors = [],
  fraudReport = null,
  warrantyEndIso = null,
  daysRemaining = null,
}) {
  const sentences = [];
  const factor = (name) => riskFactors.find((f) => f.name === name);

  // ---- 1. Invoice integrity -------------------------------------------------
  const integrity = factor('Invoice integrity');
  const signals = Array.isArray(fraudReport?.signals) ? fraudReport.signals : [];
  const synthetic = signals.some((s) => s && s.type === 'SYNTHETIC_DOCUMENT');
  if (synthetic) {
    sentences.push(
      'significant invoice integrity concerns detected. The document contains a synthetic/test marker and should not be treated as proof of purchase'
    );
  } else if (integrity && integrity.contribution >= INTEGRITY_THRESHOLD) {
    sentences.push(
      'significant invoice integrity concerns detected. The document shows signs of tampering or falsification and should be verified manually'
    );
  }

  // ---- 2. Fraud indicators ---------------------------------------------------
  const warningLevel = fraudReport?.warningLevel || null;
  if (!synthetic && !sentences.length && (warningLevel === 'FRAUDULENT' || warningLevel === 'HIGH_RISK')) {
    sentences.push(
      'suspicious invoice indicators were detected — manual verification is required before acting on this warranty claim'
    );
  }

  // ---- 3. Warranty — only when actually expired (or about to be) --------------
  if (daysRemaining !== null && daysRemaining !== undefined && Number.isFinite(daysRemaining)) {
    if (daysRemaining <= 0) {
      sentences.push(
        `warranty coverage has expired (ended ${warrantyEndIso || 'the recorded end date'})`
      );
    } else if (daysRemaining <= EXPIRING_SOON_DAYS) {
      sentences.push(
        `the warranty expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} (${warrantyEndIso || 'end date unknown'})`
      );
    }
  }

  // ---- 4. High failure risk ----------------------------------------------------
  const recalls = factor('Recalls & advisories');
  if (recalls && recalls.contribution >= RECALL_THRESHOLD) {
    sentences.push('internet research found recall or reliability concerns for this product');
  }
  const productAge = factor('Product age');
  if (daysRemaining !== null && daysRemaining <= 0 && productAge && productAge.contribution >= 15) {
    sentences.push('the product is past its warranty term; age-related failure risk is elevated');
  }

  if (sentences.length === 0) {
    return `${label} risk — no significant risk factors detected at this time.`;
  }
  return `${label} risk — ${sentences.join('. ')}.`;
}

/**
 * Actionable recommendation derived from the SAME dominant evidence.
 * Returns '' when nothing actionable applies — the engine then falls back
 * to the per-level recommendation (riskClassification.js), which is
 * generic advice, never a canned explanation.
 */
export function buildRiskRecommendation({
  riskFactors = [],
  fraudReport = null,
  daysRemaining = null,
}) {
  const parts = [];
  const factor = (name) => riskFactors.find((f) => f.name === name);

  // Invoice integrity / suspicious document
  const integrity = factor('Invoice integrity');
  const signals = Array.isArray(fraudReport?.signals) ? fraudReport.signals : [];
  const synthetic = signals.some((s) => s && s.type === 'SYNTHETIC_DOCUMENT');
  const warningLevel = fraudReport?.warningLevel || null;
  if (synthetic || (integrity && integrity.contribution >= INTEGRITY_THRESHOLD) ||
      warningLevel === 'FRAUDULENT' || warningLevel === 'HIGH_RISK') {
    parts.push(INVOICE_RECOMMENDATION);
  }

  // Expired warranty — only when actually expired
  if (daysRemaining !== null && Number.isFinite(daysRemaining) && daysRemaining <= 0) {
    parts.push(EXPIRED_WARRANTY_RECOMMENDATION);
  }

  // Product failure risk
  const recalls = factor('Recalls & advisories');
  const productAge = factor('Product age');
  if ((recalls && recalls.contribution >= RECALL_THRESHOLD) ||
      (daysRemaining !== null && daysRemaining <= 0 && productAge && productAge.contribution >= 15)) {
    parts.push(FAILURE_RISK_RECOMMENDATION);
  }

  return [...new Set(parts)].join(' ');
}

export default { buildRiskReason, buildRiskRecommendation };