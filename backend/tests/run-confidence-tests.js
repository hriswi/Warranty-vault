/**
 * run-confidence-tests.js
 *
 * Tests for the extraction confidence model (frontend/src/lib/extractionConfidence.js):
 *   - per-field provenance (ai / ocr-parser / supplement / manual)
 *   - agreement bonuses, normalization detection
 *   - overall confidence with missing-field penalties
 *   - manual-review threshold
 *
 * Run: node tests/run-confidence-tests.js
 */
import { pathToFileURL } from 'node:url';

const { computeExtractionDetails } = await import(
  pathToFileURL('C:/Autonomous-Warranty-Intelligence-System/frontend/src/lib/extractionConfidence.js').href
);

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) { passed += 1; return; }
  failed += 1;
  failures.push(message);
}

function assertEqual(actual, expected, message) {
  const ok = actual === expected;
  if (ok) { passed += 1; return; }
  failed += 1;
  failures.push(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function section(title) {
  console.log(`\n── ${title}`);
}

// ── Shared fixture: the ThinkPad full extraction ─────────────────────────────
const THINKPAD_FORM = {
  productName: 'Lenovo ThinkPad E14 Gen 5',
  brand: 'Lenovo',
  category: 'Laptop',
  purchaseDate: '2026-08-10',
  warrantyMonths: 24,
  invoiceNumber: 'TH-INV-2026-0810-0042',
  serialNumber: 'PF4X9K7L2M',
  seller: 'TechHub Electronics Pvt. Ltd.',
  price: '84960',
};

const THINKPAD_AI = {
  ...THINKPAD_FORM,
  purchasePrice: 'Rs. 84,960',
};

const THINKPAD_PARSER = {
  productName: 'Lenovo ThinkPad E14 Gen 5',
  brand: 'Lenovo',
  category: 'Laptop',
  purchaseDate: '2026-08-10',
  warrantyMonths: 24,
  invoiceNumber: 'TH-INV-2026-0810-0042',
  serialNumber: 'PF4X9K7L2M',
  seller: 'TechHub Electronics Pvt. Ltd.',
  price: 'Rs. 84,960',
};

section('extractionConfidence');

await (async () => {
  section('T1: full AI + parser agreement — high overall confidence');
  const d = computeExtractionDetails({ form: THINKPAD_FORM, aiInvoice: THINKPAD_AI, parsedInvoice: THINKPAD_PARSER, parserFieldConf: {} });
  assert(d.overallConfidence >= 0.9, `overall >= 0.9 (got ${d.overallConfidence})`);
  assertEqual(d.missingFields.length, 0, 'no missing fields');
  assertEqual(d.sourcesUsed.includes('ai'), true, 'source ai used');
  assertEqual(d.perField.productName.extractionConfidence, 0.95, 'agreeing fields score 0.95');
  assertEqual(d.needsManualReview, false, 'no manual review needed');
  assert(d.overallConfidence > 0.9 && d.overallConfidence <= 1, 'overall sane range');
  const manual = computeExtractionDetails({ form: THINKPAD_FORM, aiInvoice: null, parsedInvoice: null, parserFieldConf: {}, userEditedFields: new Set(Object.keys(THINKPAD_FORM)) });
  assertEqual(manual.overallConfidence, 1, 'all-manual input scores 1.0');
  assertEqual(manual.perField.productName.source, 'manual', 'manual provenance recorded');
})();

await (async () => {
  section('T2: AI only (parser silent) — 0.8 per field, still confident overall');
  const d = computeExtractionDetails({ form: THINKPAD_FORM, aiInvoice: THINKPAD_AI, parsedInvoice: {}, parserFieldConf: {} });
  assertEqual(d.perField.productName.extractionConfidence, 0.8, 'ai-only fields score 0.8');
  assert(d.overallConfidence >= 0.7, `overall >= 0.7 (got ${d.overallConfidence})`);
})();

await (async () => {
  section('T3: parser only — uses per-field parser confidence');
  const confs = { productName: 0.9, brand: 0.5, category: 0.75, purchaseDate: 0.8, warrantyMonths: 0.6, invoiceNumber: 0.4, serialNumber: 0.3, seller: 0.7, price: 0.65 };
  const d = computeExtractionDetails({ form: THINKPAD_FORM, aiInvoice: null, parsedInvoice: THINKPAD_PARSER, parserFieldConf: confs });
  assertEqual(d.perField.invoiceNumber.extractionConfidence, 0.4, 'parser confidence honoured');
  assertEqual(d.perField.serialNumber.extractionConfidence, 0.3, 'parser confidence honoured (low)');
  assertEqual(d.perField.productName.source, 'ocr-parser', 'provenance ocr-parser');
  assert(d.lowConfidenceFields.includes('serialNumber'), 'low-confidence field listed');
})();

await (async () => {
  section('T4: supplement fallback — 0.7 deterministic fill');
  const d = computeExtractionDetails({ form: { productName: 'Dell', category: 'Laptop', purchaseDate: '2026-01-15', warrantyMonths: 12 }, aiInvoice: null, parsedInvoice: {}, parserFieldConf: {} });
  assertEqual(d.perField.category.source, 'supplement', 'supplement provenance');
  assertEqual(d.perField.category.extractionConfidence, 0.7, 'supplement confidence 0.7');
})();

await (async () => {
  section('T5: manual edits are ground truth');
  const d = computeExtractionDetails({ form: THINKPAD_FORM, aiInvoice: THINKPAD_AI, parsedInvoice: THINKPAD_PARSER, parserFieldConf: {}, userEditedFields: new Set(['purchaseDate']) });
  assertEqual(d.perField.purchaseDate.source, 'manual', 'edited field is manual');
  assertEqual(d.perField.purchaseDate.extractionConfidence, 1, 'manual confidence 1.0');
})();

await (async () => {
  section('T6: missing fields penalize the overall confidence');
  const partialForm = { productName: 'Dell', category: 'Laptop', purchaseDate: '2026-01-15', warrantyMonths: 12 };
  const d = computeExtractionDetails({ form: partialForm, aiInvoice: null, parsedInvoice: {}, parserFieldConf: {} });
  assert(d.missingFields.length >= 5, 'missing fields listed');
  assert(d.overallConfidence < 0.9, `overall penalized (got ${d.overallConfidence})`);
  const partial = computeExtractionDetails({ form: partialForm, aiInvoice: { productName: 'Dell', category: 'Laptop' }, parsedInvoice: {}, parserFieldConf: {} });
  assert(partial.overallConfidence >= 0.05 && partial.overallConfidence < 0.9, `partial data never hardcodes a high value (got ${partial.overallConfidence})`);
})();

await (async () => {
  section('T7: manual-review threshold — low quality input flags review');
  const d = computeExtractionDetails({ form: THINKPAD_FORM, aiInvoice: null, parsedInvoice: THINKPAD_PARSER, parserFieldConf: { productName: 0.4, brand: 0.3, category: 0.4, purchaseDate: 0.3, warrantyMonths: 0.4, invoiceNumber: 0.2, serialNumber: 0.3, seller: 0.4, price: 0.3 } });
  assertEqual(d.needsManualReview, true, 'needsManualReview true');
  assert(d.lowConfidenceFields.length >= 3, 'low-confidence fields flagged');
})();

await (async () => {
  section('T8: normalization detection — price and date');
  const d = computeExtractionDetails({ form: THINKPAD_FORM, aiInvoice: THINKPAD_AI, parsedInvoice: THINKPAD_PARSER, parserFieldConf: {} });
  assertEqual(d.perField.price.normalized, true, 'price normalized (₹84,960 → 84960)');
  assertEqual(d.perField.purchaseDate.normalized, false, 'ISO date not flagged normalized');
  const dd = computeExtractionDetails({ form: { ...THINKPAD_FORM, purchaseDate: '2026-08-10' }, aiInvoice: { ...THINKPAD_AI, purchaseDate: '10-08-2026' }, parsedInvoice: THINKPAD_PARSER, parserFieldConf: {} });
  assertEqual(dd.perField.purchaseDate.normalized, true, 'non-ISO raw date flagged normalized');
})();

await (async () => {
  section('T9: ThinkPad e2e equivalence — full agreement ≈0.95, never inflated');
  const d = computeExtractionDetails({ form: THINKPAD_FORM, aiInvoice: THINKPAD_AI, parsedInvoice: THINKPAD_PARSER, parserFieldConf: {} });
  assert(d.overallConfidence >= 0.9 && d.overallConfidence <= 0.99, `overall in 0.90-0.99 (got ${d.overallConfidence})`);
})();

console.log(`\n${'─'.repeat(60)}`);
console.log(`  CONFIDENCE: ${passed} passed, ${failed} failed`);
if (failures.length) {
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
}
console.log(`${'─'.repeat(60)}\n`);
