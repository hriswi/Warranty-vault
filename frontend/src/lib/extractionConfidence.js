/**
 * extractionConfidence.js
 *
 * Computes the extraction confidence for a saved product from REAL
 * provenance per field:
 *   - value
 *   - source: 'ai' | 'ocr-parser' | 'supplement' | 'manual'
 *   - extractionConfidence (0..1)
 *   - normalized (date/price were reformatted)
 *   - validated (user reviewed the form before saving)
 *
 * Per-field confidence rules (deterministic):
 *   ai + parser agree        → 0.95 (two independent extractors agree)
 *   ai only                  → 0.80 (model read it; parser could not)
 *   parser only              → parser fieldConfidence
 *   deterministic supplement → 0.70 (table-row/classifier heuristic)
 *   manual entry             → 1.00 (user-typed = ground truth)
 *
 * Overall = weighted average over present fields, penalized by how much
 * of the schema is missing. Never a hardcoded value.
 */

export const SCHEMA_FIELDS = Object.freeze([
  'productName', 'brand', 'category', 'purchaseDate', 'warrantyMonths',
  'invoiceNumber', 'serialNumber', 'seller', 'price',
]);

export const FIELD_WEIGHTS = Object.freeze({
  productName: 0.2,
  brand: 0.1,
  category: 0.1,
  purchaseDate: 0.15,
  warrantyMonths: 0.1,
  invoiceNumber: 0.1,
  serialNumber: 0.05,
  seller: 0.1,
  price: 0.1,
});

const TOTAL_WEIGHT = Object.values(FIELD_WEIGHTS).reduce((s, w) => s + w, 0);

function normCompare(a, b) {
  if (a == null || b == null) return false;
  const s1 = String(a).trim().toLowerCase().replace(/\s+/g, ' ');
  const s2 = String(b).trim().toLowerCase().replace(/\s+/g, ' ');
  if (s1 === s2) return true;
  // number-ish tolerance: "84960" vs "84,960" vs "Rs. 84,960"
  const n1 = s1.replace(/[^0-9.]/g, '');
  const n2 = s2.replace(/[^0-9.]/g, '');
  return n1.length > 0 && n1 === n2;
}

function isNormalized(value, rawValue) {
  if (rawValue == null || value == null) return false;
  const s = String(rawValue).trim();
  const v = String(value).trim();
  if (s === v) return false;
  // raw value carries currency/separator characters → normalized price
  if (/[₹$€£,]/.test(s) || /^(rs\.?|inr|usd|eur|gbp)\s*/i.test(s)) return true;
  // final value is an ISO date but the raw value was not → normalized date
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  return false;
}

/**
 * @param {object} input
 * @param {object} input.form            Final form values being saved.
 * @param {object} [input.aiInvoice]     Qwen extraction result (backend schema).
 * @param {object} [input.parsedInvoice] Deterministic parser invoice (pipeline.invoice).
 * @param {object} [input.parserFieldConf] parser fieldConfidence map.
 * @param {Set<string>} [input.userEditedFields] fields the user typed/edited.
 * @returns {{overallConfidence: number, perField: object, missingFields: string[],
 *            lowConfidenceFields: string[], needsManualReview: boolean,
 *            sourcesUsed: string[]}}
 */
export function computeExtractionDetails({
  form = {},
  aiInvoice = null,
  parsedInvoice = null,
  parserFieldConf = {},
  userEditedFields = new Set(),
} = {}) {
  const perField = {};
  let weighted = 0;
  let weightSum = 0;

  for (const field of SCHEMA_FIELDS) {
    const value = form[field];
    const filled = value != null && String(value).trim() !== '';
    const weight = FIELD_WEIGHTS[field] ?? 0;

    if (!filled) {
      perField[field] = { value: null, source: null, extractionConfidence: null, normalized: false, validated: false, present: false };
      continue;
    }

    let source;
    let confidence;

    if (userEditedFields.has(field)) {
      source = 'manual';
      confidence = 1.0;
    } else {
      const aiValue = aiInvoice?.[aiFieldKey(field)];
      const parserValue = parsedInvoice?.[field] ?? parsedInvoice?.[aiFieldKey(field)];
      const aiPresent = aiValue != null && String(aiValue).trim() !== '';
      const parserPresent = parserValue != null && String(parserValue).trim() !== '';

      if (aiPresent && parserPresent && normCompare(aiValue, parserValue)) {
        source = 'ai';
        confidence = 0.95; // two independent extractors agree
      } else if (aiPresent) {
        source = 'ai';
        confidence = 0.8; // AI-supplied; parser did not confirm
      } else if (parserPresent) {
        source = 'ocr-parser';
        confidence = typeof parserFieldConf[field] === 'number' ? parserFieldConf[field] : 0.6;
      } else {
        source = 'supplement'; // deterministic table-row / classifier fill
        confidence = 0.7;
      }
    }

    const rawAi = aiInvoice?.[aiFieldKey(field)];
    perField[field] = {
      value,
      source,
      extractionConfidence: Math.round(confidence * 100) / 100,
      normalized: isNormalized(value, rawAi),
      validated: true, // user reviewed the form before saving
      present: true,
    };
    weighted += weight * confidence;
    weightSum += weight;
  }

  const missingFields = SCHEMA_FIELDS.filter((f) => !perField[f].present);
  const coverage = weightSum / TOTAL_WEIGHT; // 1.0 when every field is present
  const rawOverall = weightSum > 0 ? weighted / weightSum : 0;
  // Missing fields reduce confidence proportionally to their schema weight.
  const overallConfidence = Math.round(Math.min(1, Math.max(0.05, rawOverall * (0.5 + 0.5 * coverage))) * 100) / 100;

  const lowConfidenceFields = SCHEMA_FIELDS.filter(
    (f) => perField[f].present && perField[f].extractionConfidence != null && perField[f].extractionConfidence < 0.5
  );
  const sourcesUsed = [...new Set(SCHEMA_FIELDS.map((f) => perField[f].source).filter(Boolean))];

  return {
    overallConfidence,
    perField,
    missingFields,
    lowConfidenceFields,
    needsManualReview: overallConfidence < 0.55,
    sourcesUsed,
  };
}

/** Map a form field key to the extraction schema key (price ↔ purchasePrice). */
function aiFieldKey(formField) {
  if (formField === 'price') return 'purchasePrice';
  return formField;
}

export default { computeExtractionDetails, SCHEMA_FIELDS, FIELD_WEIGHTS };
