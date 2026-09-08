/**
 * run-risk-fraud-tests.js
 *
 * Regression tests for the canonical risk classification, warranty end
 * date, synthetic-document fraud detection and invoice-integrity wiring.
 *
 * Coverage (A–L):
 *   A. Genuine invoice text             -> fraud CLEAN, no SYNTHETIC signal
 *   B. Synthetic marker in raw text     -> SYNTHETIC_DOCUMENT, SUSPICIOUS
 *   C. Marker phrase variants           -> all flagged ("TEST DOCUMENT",
 *                                          "dummy invoice", "generated for
 *                                          testing purposes")
 *   D. Placeholder invoice number       -> flagged without body markers
 *   E. Missing invoice data             -> risk INSUFFICIENT_DATA (kept)
 *   F. Integrity assessed vs not        -> "checked" wording vs "not assessed"
 *   G. Warranty end dates               -> 24m/12m/1m, month-end, leap year,
 *                                          consistency with risk evidence
 *   H. Classification determinism       -> boundary scores map to exact levels
 *   I. Integrity drives risk            -> synthetic fresh product is HIGH,
 *                                          clean fraud stays LOW
 *   J. Missing evidence + no fraud run  -> INSUFFICIENT_DATA + not-assessed
 *   K. Description matches level        -> label/description/recommendation
 *   L. Full pipeline on dummy invoice   -> SYNTHETIC_DOCUMENT + HIGH risk +
 *                                          canonical warranty end in evidence
 *   M. Warranty remaining is dynamic      -> 728 days on 2026-08-13, canonical
 *                                          helper agrees, expired goes negative
 *   N. Risk reason is evidence-driven     -> synthetic marker -> integrity
 *                                          story; expiry only when real
 *   O. Normal invoice                        -> CLEAN, no synthetic flag,
 *                                          not Critical
 *   P. Recommendation follows dominant risk -> integrity/expiry/failure
 *                                          wording, never level-based
 *   Q. Warranty % accurate                  -> 99.6% remaining, dynamic
 *   R. OCR/missing fields separate          -> lower confidence, never fraud
 *   S. Canonical risk result                -> score = sum of factors, level
 *                                          from the single classifier
 */

import { analyzeInvoiceFraud } from '../ai-engine/fraudDetectionEngine.js';
import { computeProductRisk } from '../ai-engine/productRiskEngine.js';
import {
  classifyRiskLevel,
  riskLevelFor,
  riskLevelLabelFor,
  riskRecommendationFor,
  RISK_LEVELS,
  RISK_LEVEL_DEFS,
} from '../ai-engine/riskClassification.js';
import { warrantyEndIso, addMonths, toISODateOnly, warrantyEndDate, daysBetween } from '../utils/dateUtils.js';
import { processInvoiceText } from '../ai-engine/warrantyIntelligencePipeline.js';
import { readFileSync } from 'node:fs';

const REF = new Date('2026-08-13T12:00:00');
const DUMMY_TEXT = readFileSync('C:/Users/Prasanth/AppData/Local/Temp/opencode/dummypdf.txt', 'utf8');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, extra = '') {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${extra ? `  (${extra})` : ''}`);
  }
}

function group(title) {
  console.log(`\n${title}`);
}

// ── A: genuine invoice text ────────────────────────────────────────────────
group('A. Genuine invoice text -> CLEAN');
{
  const text = 'TechHub Electronics  TAX INVOICE  Invoice No: TH-INV-2026-0001  Invoice Date: 10-08-2026  Seller: TechHub Electronics Pvt. Ltd.  Product: Laptop Computer  Brand: Lenovo  Model: ThinkPad E14 Gen 5  Qty: 1  Unit Price: Rs. 72,000  Total: Rs. 72,000  Serial Number: PF4X9K7L2M  Purchase Date: 10-08-2026  Warranty: 24 months manufacturer warranty  Grand Total: Rs. 84,960  Thank you for your purchase.';
  const f = analyzeInvoiceFraud({}, text);
  check('no synthetic signal', !f.signals.some((s) => s.type === 'SYNTHETIC_DOCUMENT'), JSON.stringify(f.signals.map((s) => s.type)));
  check('warningLevel CLEAN', f.warningLevel === 'CLEAN', f.warningLevel);
}

// ── B: synthetic marker in raw text ────────────────────────────────────────
group('B. Synthetic marker in raw text');
{
  const f = analyzeInvoiceFraud({}, DUMMY_TEXT);
  const sig = f.signals.find((s) => s.type === 'SYNTHETIC_DOCUMENT');
  check('SYNTHETIC_DOCUMENT detected', Boolean(sig));
  check('severity 0.85 (HIGH)', sig && sig.severity === 0.85, sig && sig.severity);
  check('fraudScore >= 85', f.fraudScore >= 85, f.fraudScore);
  check('warningLevel SUSPICIOUS (synthetic marker, not confirmed fraud)', f.warningLevel === 'SUSPICIOUS', f.warningLevel);
  check('detail names the marker', sig && /synthetic|test/i.test(sig.detail), sig && sig.detail);
}

// ── C: marker phrase variants ──────────────────────────────────────────────
group('C. Marker phrase variants');
{
  const variants = [
    'TEST DOCUMENT — do not use',
    'This is a dummy invoice for demonstration.',
    'Invoice generated for testing purposes only.',
    'SAMPLE RECEIPT - not a real receipt.',
    'Fictional document created for evaluation.',
    'MOCK INVOICE - placeholder data only.',
  ];
  for (const v of variants) {
    const f = analyzeInvoiceFraud({}, v);
    check(`"${v.slice(0, 32)}..." flagged`, f.signals.some((s) => s.type === 'SYNTHETIC_DOCUMENT'), f.warningLevel);
  }
}

// ── D: placeholder field values ────────────────────────────────────────────
group('D. Placeholder field values');
{
  const f1 = analyzeInvoiceFraud({ invoiceNumber: 'INV-TEST-001' }, '');
  check('invoiceNumber INV-TEST-001 flagged', f1.signals.some((s) => s.type === 'SYNTHETIC_DOCUMENT'));
  const f2 = analyzeInvoiceFraud({ serialNumber: 'SAMPLE123' }, '');
  check('serialNumber SAMPLE123 flagged', f2.signals.some((s) => s.type === 'SYNTHETIC_DOCUMENT'));
  const f3 = analyzeInvoiceFraud({ invoiceNumber: 'TH-INV-2026-0042' }, '');
  check('genuine-looking number clean', f3.signals.length === 0, f3.warningLevel);
}

// ── E: missing invoice data ────────────────────────────────────────────────
group('E. Missing invoice data -> INSUFFICIENT_DATA');
{
  const r = computeProductRisk({ productName: 'ThinkPad E14 Gen 5' }, REF, {});
  check('riskScore null', r.riskScore === null, r.riskScore);
  check('level INSUFFICIENT_DATA', r.riskLevel === 'INSUFFICIENT_DATA', r.riskLevel);
  check('label "Insufficient data"', r.riskLevelLabel === 'Insufficient data', r.riskLevelLabel);
  check('reason present on INSUFFICIENT_DATA', typeof r.riskReason === 'string' && r.riskReason.length > 0);
  check('no legacy riskLevelDescription field', !('riskLevelDescription' in r), JSON.stringify(Object.keys(r)));
}

// ── F: integrity assessed vs not assessed ──────────────────────────────────
group('F. Integrity assessed vs not assessed');
{
  const fresh = {
    productName: 'ThinkPad E14 Gen 5', brand: 'Lenovo', category: 'Laptop',
    purchaseDate: '2026-08-10', warrantyMonths: 24, overallConfidence: 0.9,
    invoiceNumber: 'TH-INV-1', seller: 'TechHub Electronics',
  };
  const assessed = computeProductRisk(fresh, REF, { fraudReport: { fraudScore: 0, signals: [] } });
  const integrity = assessed.riskFactors.find((f) => f.name === 'Invoice integrity');
  check('assessed -> contribution 0', integrity.contribution === 0, integrity.contribution);
  check('assessed -> factor evidence "no flags"', integrity.evidence === 'no flags', integrity.evidence);
  check('assessed -> evidence "checked — no flags"', assessed.riskEvidence.some((e) => e.description.includes('checked — no flags')));
  check('assessed -> NO "not assessed" warning', !assessed.riskWarnings.some((w) => w.includes('not assessed')));

  const notAssessed = computeProductRisk(fresh, REF, {});
  const intNA = notAssessed.riskFactors.find((f) => f.name === 'Invoice integrity');
  check('not assessed -> contribution 0', intNA.contribution === 0, intNA.contribution);
  check('not assessed -> factor evidence "not assessed"', intNA.evidence === 'not assessed', intNA.evidence);
  check('not assessed -> warning present', notAssessed.riskWarnings.some((w) => w.includes('not assessed')));
  check('not assessed -> evidence present', notAssessed.riskEvidence.some((e) => e.description.includes('not assessed')));
  check('not assessed -> explanation honest', intNA.explanation.includes('not assessed'), intNA.explanation);
}

// ── G: warranty end dates ──────────────────────────────────────────────────
group('G. Warranty end dates');
{
  check('24 months -> 2028-08-10', warrantyEndIso('2026-08-10', 24) === '2028-08-10', warrantyEndIso('2026-08-10', 24));
  check('12 months -> 2027-08-10', warrantyEndIso('2026-08-10', 12) === '2027-08-10', warrantyEndIso('2026-08-10', 12));
  check('1 month -> 2026-09-10', warrantyEndIso('2026-08-10', 1) === '2026-09-10', warrantyEndIso('2026-08-10', 1));
  check('month-end clamp -> Feb 28', warrantyEndIso('2026-01-31', 1) === '2026-02-28', warrantyEndIso('2026-01-31', 1));
  check('leap year -> Feb 29', warrantyEndIso('2028-01-31', 1) === '2028-02-29', warrantyEndIso('2028-01-31', 1));
  check('null term -> null', warrantyEndIso('2026-08-10', null) === null);
  check('addMonths matches helper', toISODateOnly(addMonths(new Date('2026-08-10'), 24)) === '2028-08-10');

  const fresh = {
    productName: 'ThinkPad E14 Gen 5', brand: 'Lenovo', category: 'Laptop',
    purchaseDate: '2026-08-10', warrantyMonths: 24, overallConfidence: 0.9,
    invoiceNumber: 'TH-INV-1', seller: 'TechHub Electronics',
  };
  const r = computeProductRisk(fresh, REF, { fraudReport: { fraudScore: 0, signals: [] } });
  const endEvidence = r.riskEvidence.filter((e) => e.description.includes('Warranty end'));
  check('risk evidence shows 2028-08-10', endEvidence.some((e) => e.description.includes('2028-08-10')), JSON.stringify(endEvidence.map((e) => e.description)));
  check('risk evidence never 2028-08-09', !endEvidence.some((e) => e.description.includes('2028-08-09')), JSON.stringify(endEvidence.map((e) => e.description)));
}

// ── H: classification determinism ──────────────────────────────────────────
group('H. Classification determinism');
{
  const cases = [[null, null], [0, 'LOW'], [24, 'LOW'], [25, 'MEDIUM'], [49, 'MEDIUM'], [50, 'HIGH'], [74, 'HIGH'], [75, 'CRITICAL'], [100, 'CRITICAL']];
  for (const [score, level] of cases) {
    check(`score ${score} -> ${level}`, riskLevelFor(score) === level, riskLevelFor(score));
  }
  check('label 38 -> Medium (canonical)', riskLevelLabelFor(38) === 'Medium', riskLevelLabelFor(38));
  check('label 51 -> High', riskLevelLabelFor(51) === 'High', riskLevelLabelFor(51));
  check('classify clamps 150 -> CRITICAL', riskLevelFor(150) === 'CRITICAL');
  check('four canonical levels only', JSON.stringify(RISK_LEVELS) === JSON.stringify(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']));
}

// ── I: integrity drives risk ───────────────────────────────────────────────
group('I. Integrity drives risk');
{
  const fresh = {
    productName: 'ThinkPad E14 Gen 5', brand: 'Lenovo', category: 'Laptop',
    purchaseDate: '2026-08-10', warrantyMonths: 24, overallConfidence: 0.9,
    invoiceNumber: 'TH-INV-1', seller: 'TechHub Electronics',
  };
  const clean = computeProductRisk(fresh, REF, { fraudReport: { fraudScore: 0, signals: [] } });
  check('clean fraud -> LOW', clean.riskLevel === 'LOW', `${clean.riskScore} ${clean.riskLevel}`);

  const syntheticReport = analyzeInvoiceFraud({}, DUMMY_TEXT);
  const flagged = computeProductRisk(fresh, REF, { fraudReport: syntheticReport });
  const integrity = flagged.riskFactors.find((f) => f.name === 'Invoice integrity');
  check('synthetic -> level HIGH or CRITICAL', ['HIGH', 'CRITICAL'].includes(flagged.riskLevel), `${flagged.riskScore} ${flagged.riskLevel}`);
  check('synthetic -> integrity contribution >= 50', integrity.contribution >= 50, integrity.contribution);
  check('synthetic -> factor evidence flag count', typeof integrity.evidence === 'string' && integrity.evidence.includes('flag'), integrity.evidence);
  check('synthetic -> SYNTHETIC_DOCUMENT in evidence', flagged.riskEvidence.some((e) => e.type === 'SYNTHETIC_DOCUMENT'));
  check('synthetic -> explanation names integrity flags', integrity.explanation.includes('integrity flag'), integrity.explanation);
}

// ── J: missing evidence + no fraud run ─────────────────────────────────────
group('J. Missing evidence + no fraud run');
{
  const r = computeProductRisk({ category: 'Laptop' }, REF, {});
  check('INSUFFICIENT_DATA kept', r.riskLevel === 'INSUFFICIENT_DATA', r.riskLevel);
  check('not-assessed warning present', r.riskWarnings.some((w) => w.includes('not assessed')), JSON.stringify(r.riskWarnings));
  check('recommendation present', typeof r.recommendation === 'string' && r.recommendation.length > 0);
}

// ── K: description matches level ───────────────────────────────────────────
group('K. Description matches level');
{
  for (const level of RISK_LEVELS) {
    const rec = riskRecommendationFor(level);
    check(`recommendation exists for ${level}`, typeof rec === 'string' && rec.length > 0);
  }
  check('recommendation is per-level advice', riskRecommendationFor('MEDIUM') === RISK_LEVEL_DEFS.find((d) => d.level === 'MEDIUM').recommendation);
  check('no generic canned explanation left', RISK_LEVEL_DEFS.every((d) => !('description' in d)), JSON.stringify(RISK_LEVEL_DEFS.map((d) => Object.keys(d))));
  check('unknown level -> null', riskRecommendationFor('NOPE') === null);

  const fresh = {
    productName: 'ThinkPad E14 Gen 5', brand: 'Lenovo', category: 'Laptop',
    purchaseDate: '2026-08-10', warrantyMonths: 24, overallConfidence: 0.9,
    invoiceNumber: 'TH-INV-1', seller: 'TechHub Electronics',
  };
  const r = computeProductRisk(fresh, REF, { fraudReport: { fraudScore: 0, signals: [] } });
  check('engine recommendation === canonical per-level action', r.recommendation === riskRecommendationFor(r.riskLevel), `${r.recommendation} vs ${riskRecommendationFor(r.riskLevel)}`);
  check('recommendation is advice, never the old generic explanation', !r.recommendation.includes('expired coverage'), r.recommendation);
  check('label/level agree', riskLevelFor(r.riskScore) === r.riskLevel && riskLevelLabelFor(r.riskScore) === r.riskLevelLabel);
}

// ── L: full pipeline on dummy invoice ──────────────────────────────────────
group('L. Full pipeline on dummy invoice');
{
  const pipe = await processInvoiceText(DUMMY_TEXT, { referenceDate: REF });
  check('pipeline success', pipe.success === true, pipe.error);
  check('fraud not CLEAN', pipe.fraud.warningLevel !== 'CLEAN', pipe.fraud.warningLevel);
  check('SYNTHETIC_DOCUMENT in signals', pipe.fraud.signals.some((s) => s.type === 'SYNTHETIC_DOCUMENT'), JSON.stringify(pipe.fraud.signals.map((s) => s.type)));
  check('risk not LOW', pipe.risk.riskLevel !== 'LOW', `${pipe.risk.riskScore} ${pipe.risk.riskLevel}`);
  check('integrity factor >= 50', pipe.risk.riskFactors.some((f) => f.name === 'Invoice integrity' && f.contribution >= 50));
  check('warranty end evidence 2028-08-10', pipe.risk.riskEvidence.some((e) => e.description.includes('2028-08-10')));
  check('no legacy riskLevelDescription in pipeline output', !('riskLevelDescription' in pipe.risk), JSON.stringify(Object.keys(pipe.risk)));
  check('advisory timeline local date', pipe.advisory.warrantyTimeline && pipe.advisory.warrantyTimeline.expiryDate === '2028-08-10', pipe.advisory?.warrantyTimeline?.expiryDate);
  check('stage order: fraud before risk', pipe.stageStatuses.fraudDetection === 'OK' && pipe.stageStatuses.riskScoring === 'OK');
}

// ●●● M: warranty remaining is dynamic days, not a stale 0 ●●●
group('M. Warranty remaining is dynamic days');
{
  const fresh = {
    productName: 'ThinkPad E14 Gen 5', brand: 'Lenovo', category: 'Laptop',
    purchaseDate: '2026-08-10', warrantyMonths: 24, overallConfidence: 0.9,
    invoiceNumber: 'TH-INV-1', seller: 'TechHub Electronics',
  };
  const r = computeProductRisk(fresh, REF, { fraudReport: { fraudScore: 0, signals: [] } });
  const wf = r.riskFactors.find((f) => f.name === 'Warranty remaining');
  check('warranty factor present', Boolean(wf), JSON.stringify(r.riskFactors.map((f) => f.name)));
  check('daysRemaining = 728 (purchase + 24m - today)', wf && wf.daysRemaining === 728, wf && wf.daysRemaining);
  check('totalWarrantyDays = 731', wf && wf.totalWarrantyDays === 731, wf && wf.totalWarrantyDays);
  check('warrantyEndIso = 2028-08-10', wf && wf.warrantyEndIso === '2028-08-10', wf && wf.warrantyEndIso);
  check('contribution 0 (full coverage = zero RISK POINTS)', wf && wf.contribution === 0, wf && wf.contribution);
  check('explanation states 728 days', wf && wf.explanation.includes('728'), wf && wf.explanation);
  check('factor not expired', wf && wf.severity !== 'high', wf && wf.severity);
  const canonical = warrantyEndDate(new Date('2026-08-10'), 24);
  check('daysRemaining matches canonical helper', wf && wf.daysRemaining === daysBetween(REF, canonical), `${wf && wf.daysRemaining} vs ${daysBetween(REF, canonical)}`);
  const expired = computeProductRisk({ ...fresh, purchaseDate: '2024-08-10' }, REF, { fraudReport: { fraudScore: 0, signals: [] } });
  const we = expired.riskFactors.find((f) => f.name === 'Warranty remaining');
  check('expired -> daysRemaining negative', we && we.daysRemaining < 0, we && we.daysRemaining);
  check('expired -> severity high', we && we.severity === 'high', we && we.severity);
  check('expired -> contribution >= 40', we && we.contribution >= 40, we && we.contribution);
  check('expired -> warrantyEndIso 2026-08-10', we && we.warrantyEndIso === '2026-08-10', we && we.warrantyEndIso);
}

// ●●● N: riskReason is evidence-driven, never claims expired warranty wrongly ●●●
group('N. Risk reason is evidence-driven');
{
  const fresh = {
    productName: 'ThinkPad E14 Gen 5', brand: 'Lenovo', category: 'Laptop',
    purchaseDate: '2026-08-10', warrantyMonths: 24, overallConfidence: 0.9,
    invoiceNumber: 'TH-INV-1', seller: 'TechHub Electronics',
  };
  const syntheticReport = analyzeInvoiceFraud({}, DUMMY_TEXT);
  const flagged = computeProductRisk(fresh, REF, { fraudReport: syntheticReport });
  check('reason present', typeof flagged.riskReason === 'string' && flagged.riskReason.length > 0, flagged.riskReason);
  check('reason names synthetic/test marker', flagged.riskReason.includes('synthetic/test marker'), flagged.riskReason);
  check('reason does NOT claim expired warranty', !flagged.riskReason.includes('expired'), flagged.riskReason);
  check('reason leads with level label', flagged.riskReason.startsWith(`${flagged.riskLevelLabel} risk`), flagged.riskReason);
  const clean = computeProductRisk(fresh, REF, { fraudReport: { fraudScore: 0, signals: [] } });
  check('clean reason: no significant factors', clean.riskReason.includes('no significant risk factors'), clean.riskReason);
  check('clean reason: no integrity claim', !clean.riskReason.includes('integrity'), clean.riskReason);
  check('clean reason: no expired claim', !clean.riskReason.includes('expired'), clean.riskReason);
  const expired = computeProductRisk({ ...fresh, purchaseDate: '2024-08-10' }, REF, { fraudReport: { fraudScore: 0, signals: [] } });
  check('expired reason names expiry date', expired.riskReason.includes('expired (ended 2026-08-10'), expired.riskReason);
  check('expired reason does not claim synthetic', !expired.riskReason.includes('synthetic'), expired.riskReason);
  const both = computeProductRisk({ ...fresh, purchaseDate: '2024-08-10' }, REF, { fraudReport: syntheticReport });
  check('combined reason has both stories', both.riskReason.includes('expired') && both.riskReason.includes('synthetic/test marker'), both.riskReason);
  const ins = computeProductRisk({ category: 'Laptop' }, REF, {});
  check('insufficient branch has reason', typeof ins.riskReason === 'string' && ins.riskReason.length > 0, ins.riskReason);
  // REGRESSION: active warranty + synthetic invoice -> exactly ONE explanation,
  // the integrity one; the legacy generic 'expired coverage' text is GONE.
  check('single explanation field only (no riskLevelDescription)', !('riskLevelDescription' in flagged), JSON.stringify(Object.keys(flagged)));
  check('no "expired coverage" in reason or recommendation', !flagged.riskReason.includes('expired coverage') && !flagged.recommendation.includes('expired coverage'), `${flagged.riskReason} || ${flagged.recommendation}`);
  check('recommendation follows dominant factor (integrity)', flagged.recommendation === 'Do not use this invoice as proof of purchase. Verify the original invoice with the seller before relying on the warranty.', flagged.recommendation);
  check('never "professional service advice" for invoice integrity', !flagged.recommendation.includes('professional service'), flagged.recommendation);
  const pipe = await processInvoiceText(DUMMY_TEXT, { referenceDate: REF });
  check('pipeline riskReason present', typeof pipe.risk.riskReason === 'string' && pipe.risk.riskReason.length > 0, pipe.risk.riskReason);
}

// ●● O: normal invoice — no synthetic flag, not Critical ●●
group('O. Normal invoice stays normal');
{
  const NORMAL_TEXT = readFileSync('C:/Autonomous-Warranty-Intelligence-System/backend/tests/fixtures/normal-invoice.txt', 'utf8');
  const fraud = analyzeInvoiceFraud({}, NORMAL_TEXT);
  check('normal -> no SYNTHETIC_DOCUMENT signal', !fraud.signals.some((s) => s.type === 'SYNTHETIC_DOCUMENT'), JSON.stringify(fraud.signals.map((s) => s.type)));
  check('normal -> warningLevel CLEAN', fraud.warningLevel === 'CLEAN', `${fraud.warningLevel} (${fraud.fraudScore})`);
  const parsed = {
    productName: 'Lenovo ThinkPad E14 Gen 5', brand: 'Lenovo', category: 'Laptop',
    purchaseDate: '2026-08-10', warrantyMonths: 24, overallConfidence: 0.9,
    invoiceNumber: 'INV-2026-0912', serialNumber: 'LEN26104417', seller: 'TechHub Electronics',
  };
  const r = computeProductRisk(parsed, REF, { fraudReport: fraud });
  check('normal -> not Critical', r.riskLevel !== 'CRITICAL', `${r.riskScore} ${r.riskLevel}`);
  const integrity = r.riskFactors.find((f) => f.name === 'Invoice integrity');
  check('normal -> integrity contribution 0', integrity && integrity.contribution === 0, integrity && integrity.contribution);
  check('normal -> reasonable score (LOW/MEDIUM)', r.riskScore != null && r.riskScore < 50, `${r.riskScore} ${r.riskLevel}`);
  check('normal -> no expired/integrity claims in reason', !/expired|integrity concerns/.test(r.riskReason), r.riskReason);
}

// ●● P: recommendation is generated from the dominant factor ●●
group('P. Recommendation follows dominant risk');
{
  const fresh = {
    productName: 'ThinkPad E14 Gen 5', brand: 'Lenovo', category: 'Laptop',
    purchaseDate: '2026-08-10', warrantyMonths: 24, overallConfidence: 0.62,
    invoiceNumber: 'TH-INV-1', seller: 'TechHub Electronics',
  };
  const syntheticReport = analyzeInvoiceFraud({}, DUMMY_TEXT);
  const f = computeProductRisk(fresh, REF, { fraudReport: syntheticReport });
  check('active+suspicious -> invoice-integrity recommendation', f.recommendation === 'Do not use this invoice as proof of purchase. Verify the original invoice with the seller before relying on the warranty.', f.recommendation);
  const expired = computeProductRisk({ ...fresh, purchaseDate: '2024-08-10' }, REF, { fraudReport: { fraudScore: 0, signals: [], warningLevel: 'CLEAN' } });
  check('expired -> warranty recommendation', expired.recommendation.includes('Warranty coverage has expired'), expired.recommendation);
  check('expired -> no invoice recommendation', !expired.recommendation.includes('proof of purchase'), expired.recommendation);
  const both = computeProductRisk({ ...fresh, purchaseDate: '2024-08-10' }, REF, { fraudReport: syntheticReport });
  check('combined -> both recommendations present once', both.recommendation.includes('proof of purchase') && both.recommendation.includes('Warranty coverage has expired'), both.recommendation);
  const clean = computeProductRisk(fresh, REF, { fraudReport: { fraudScore: 0, signals: [], warningLevel: 'CLEAN' } });
  check('clean LOW -> per-level fallback advice', clean.recommendation === riskRecommendationFor(clean.riskLevel), clean.recommendation);
}

// ●● Q: warranty percentage is accurate and dynamic ●●
group('Q. Warranty percentage accurate');
{
  const parsed = {
    productName: 'ThinkPad E14 Gen 5', brand: 'Lenovo', category: 'Laptop',
    purchaseDate: '2026-08-10', warrantyMonths: 24, overallConfidence: 0.9,
    invoiceNumber: 'TH-INV-1', seller: 'TechHub Electronics',
  };
  const r = computeProductRisk(parsed, REF, { fraudReport: { fraudScore: 0, signals: [] } });
  const wf = r.riskFactors.find((f) => f.name === 'Warranty remaining');
  check('explanation = 728 days remaining of 731 total days (99.6% remaining)', wf && wf.explanation.includes('728 days remaining of 731 total days (99.6% remaining)'), wf && wf.explanation);
  const exact = parseFloat(((728 / 731) * 100).toFixed(1));
  check('percentage matches dynamic calc', wf && wf.explanation.includes(String(exact)), `${wf && wf.explanation} | ${exact}`);
}

// ●● R: OCR quality and missing fields are NOT fraud ●●
group('R. OCR/missing fields separate from fraud');
{
  const poorOcr = analyzeInvoiceFraud({
    invoiceNumber: 'INV-2026-0912', serialNumber: 'LEN26104417', purchaseDate: '2026-08-10',
    overallConfidence: 0.35,
    fieldSources: { purchaseDate: 'document-wide date scan (no explicit purchase-date label found)' },
  }, 'messy OCR text with poor quality lines everywhere');
  check('poor OCR -> CLEAN, no signals', poorOcr.warningLevel === 'CLEAN' && poorOcr.signals.length === 0, `${poorOcr.warningLevel} ${JSON.stringify(poorOcr.signals.map((s) => s.type))}`);
  check('no MISSING_DATE_LABEL signal type exists', !poorOcr.signals.some((s) => s.type === 'MISSING_DATE_LABEL'));
  const lowConf = computeProductRisk({
    category: 'Laptop', purchaseDate: '2026-08-10', warrantyMonths: 24, overallConfidence: 0.35,
    invoiceNumber: 'INV-2026-0912', seller: 'TechHub Electronics',
  }, REF, { fraudReport: poorOcr });
  const integ = lowConf.riskFactors.find((f) => f.name === 'Invoice integrity');
  const conf = lowConf.riskFactors.find((f) => f.name === 'Data confidence');
  check('poor OCR -> integrity contribution still 0', integ && integ.contribution === 0, integ && integ.contribution);
  check('poor OCR -> data confidence factor carries the hit', conf && conf.contribution >= 25, conf && conf.contribution);
  const noSerial = analyzeInvoiceFraud({ invoiceNumber: 'INV-2026-0912', purchaseDate: '2026-08-10' }, 'clean text');
  check('missing serial -> CLEAN, incomplete data not fraud', noSerial.warningLevel === 'CLEAN' && noSerial.signals.length === 0, noSerial.warningLevel);
}

// ●● S: one canonical deterministic risk result ●●
group('S. Canonical risk result');
{
  const fresh = {
    productName: 'ThinkPad E14 Gen 5', brand: 'Lenovo', category: 'Laptop',
    purchaseDate: '2026-08-10', warrantyMonths: 24, overallConfidence: 0.62,
    invoiceNumber: 'TH-INV-1', seller: 'TechHub Electronics',
  };
  const syntheticReport = analyzeInvoiceFraud({}, DUMMY_TEXT);
  const r = computeProductRisk(fresh, REF, { fraudReport: syntheticReport });
  const sum = riskFactors => Math.min(100, Math.round(riskFactors.reduce((a, f) => a + (f.contribution || 0), 0)));
  check('score = sum of factor contributions (not an LLM estimate)', r.riskScore === sum(r.riskFactors), `${r.riskScore} vs ${sum(r.riskFactors)}`);
  check('level derived from score by the single classifier', r.riskLevel === riskLevelFor(r.riskScore) && r.riskLevelLabel === riskLevelLabelFor(r.riskScore), `${r.riskLevel} ${r.riskLevelLabel}`);
  check('canonical fields present', r.riskScore != null && r.riskLevel != null && r.riskConfidence != null && Array.isArray(r.riskFactors) && Array.isArray(r.riskEvidence) && Array.isArray(r.riskWarnings) && typeof r.riskReason === 'string' && r.recommendation.length > 0, JSON.stringify(Object.keys(r)));
  check('known calibration: 53 integrity + 23 confidence + 10 category + 5 age = 91', r.riskScore === 91 && r.riskLevel === 'CRITICAL', `${r.riskScore} ${r.riskLevel}`);
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n\nrisk-fraud tests: ${pass} passed, ${fail} failed\n`);
if (fail > 0) {
  console.log('Failures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
