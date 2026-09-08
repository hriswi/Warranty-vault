/* eslint-disable max-len */
/**
 * productRiskEngine.js
 *
 * PRODUCT RISK ENGINE
 *
 * Deterministic, fully explainable product risk scoring.
 *
 * The score is the sum of five independently-calculated factors, each with
 * its own evidence trail, severity, and plain-language explanation:
 *
 *   1. Warranty remaining   — how much manufacturer coverage is left
 *   2. Product age          — time since purchase vs warranty term
 *   3. Category reference   — historical failure rate of the category
 *   4. Invoice integrity    — fraud/forgery signals from the fraud engine
 *   5. Data confidence      — extraction confidence of the parsed invoice
 *
 * Optional 6th factor: "Recalls & advisories" — internet research evidence
 * (recall notices, service advisories, known reliability issues) supplied
 * via options.externalEvidence.
 *
 * Scoring semantics:
 *   <25  LOW       (well-covered, no red flags)
 *   25-49 MEDIUM   (moderate exposure — monitor + file claims in time)
 *   50-74 HIGH     (expired coverage / suspicious document / weak data)
 *   75+  CRITICAL  (expired coverage PLUS recall evidence, or very low
 *                   extraction confidence, or strong fraud signals)
 *
 * When fewer than 3 core evidence blocks are present the engine returns
 * INSUFFICIENT_DATA with a riskScore of null instead of a made-up number.
 *
 * Risk confidence is computed from the evidence blocks actually present —
 * never hardcoded. Missing evidence reduces confidence proportionally.
 */

import { warrantyEndDate, daysBetween, toISODateOnly } from '../utils/dateUtils.js';
import { classifyRiskLevel, riskRecommendationFor } from './riskClassification.js';
import { buildRiskReason, buildRiskRecommendation } from './riskReason.js';
import { getRepairCostData } from '../data/repairCostDatabase.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round = (n) => Math.round(n * 100) / 100;

const INSUFFICIENT_LEVEL = Object.freeze({
  level: 'INSUFFICIENT_DATA',
  label: 'Insufficient data',
  description: 'Insufficient data — risk cannot be classified until more evidence is provided.',
  recommendation: 'Risk score withheld — not enough evidence (purchase date, category, confidence, identity, warranty term) to classify the product.',
});

// Level classification lives in ./riskClassification.js (single source of
// truth shared by the engine, dashboards, pages and agent monitors).

/**
 * Core evidence blocks. The score is only meaningful when at least three
 * of these are present — otherwise INSUFFICIENT_DATA is returned.
 */
function evidenceBlockSummary(parsedInvoice, durationMonths, overallConf) {
  const hasWarranty = Boolean(parsedInvoice.purchaseDate && durationMonths);
  const hasAge = Boolean(parsedInvoice.purchaseDate);
  const hasCategory = Boolean(parsedInvoice.category);
  const hasConfidence = overallConf != null;
  const hasIdentity = Boolean(
    parsedInvoice.invoiceNumber || parsedInvoice.serialNumber || parsedInvoice.seller
  );
  const blocks = [
    { name: 'warranty coverage', present: hasWarranty },
    { name: 'product age', present: hasAge },
    { name: 'product category', present: hasCategory },
    { name: 'extraction confidence', present: hasConfidence },
    { name: 'invoice identity', present: hasIdentity },
  ];
  return { count: blocks.filter((b) => b.present).length, blocks };
}

/**
 * Main risk score computation.
 *
 * @param {object} parsedInvoice  Output of invoiceParser.parseInvoice()
 *                                (product-level fields are all that is read).
 * @param {Date}   [referenceDate]
 * @param {object} [options]
 * @param {object|null} [options.fraudReport]  Output of analyzeInvoiceFraud
 *                                             (run BEFORE risk in the pipeline).
 * @param {Array|null}  [options.externalEvidence]  Internet research items
 *                        [{title,url,snippet,category}] or 'none-found'
 *                        (researched but no hits). null = not researched.
 * @param {number|null} [options.overallConfidenceOverride]  Better confidence
 *                        computed at save time from real extraction provenance.
 * @returns {object} Risk report.
 */
export function computeProductRisk(parsedInvoice, referenceDate = new Date(), options = {}) {
  const { fraudReport = null, externalEvidence = null, overallConfidenceOverride = null } = options;

  const product = parsedInvoice?.productName || 'Unknown Product';
  const brand = parsedInvoice?.brand ?? null;
  const category = parsedInvoice?.category ?? null;
  const purchaseDate = parsedInvoice?.purchaseDate ?? null;
  const warrantyMonths = parsedInvoice?.warrantyMonths ?? null;
  const allWarrantyMentions = parsedInvoice?.allWarrantyMentions || [];
  const overallConf = overallConfidenceOverride ?? parsedInvoice?.overallConfidence ?? null;

  const durationMonths = warrantyMonths
    || (allWarrantyMentions?.length ? allWarrantyMentions[0].months : null);

  const riskFactors = [];
  const riskEvidence = [];
  const riskWarnings = [];
  const recordedAt = new Date().toISOString();

  // ── Evidence gates ─────────────────────────────────────────────────────────
  const ev = evidenceBlockSummary(parsedInvoice || {}, durationMonths, overallConf);
  if (ev.count < 3) {
    const missing = ev.blocks.filter((b) => !b.present).map((b) => b.name);
    const fraudRanEarly = Boolean(
      fraudReport && (
        Array.isArray(fraudReport.signals) ||
        Number.isFinite(Number(fraudReport.fraudScore))
      )
    );
    return {
      product,
      brand,
      category,
      riskScore: null,
      riskLevel: INSUFFICIENT_LEVEL.level,
      riskLevelLabel: INSUFFICIENT_LEVEL.label,
      riskReason: INSUFFICIENT_LEVEL.recommendation,
      riskConfidence: 0.25,
      riskFactors: [{
        name: 'Evidence completeness',
        contribution: null,
        severity: 'medium',
        explanation: `Only ${ev.count} of 5 core evidence blocks are present — cannot calculate a meaningful risk score.`,
        evidence: `Missing evidence: ${missing.join(', ')}`,
      }],
      riskEvidence: [{
        type: 'calculated',
        description: `Risk score withheld: missing evidence — ${missing.join(', ')}.`,
        source: 'evidence-gate',
        recordedAt,
      },
      ...(!fraudRanEarly
        ? [{
            type: 'calculated',
            description: 'Invoice integrity: not assessed — no fraud analysis was run on this document.',
            source: 'fraud-engine',
            recordedAt,
          }]
        : []),
    ],
      riskWarnings: [
        ...missing.map((m) => `Missing evidence: ${m}.`),
        ...(!fraudRanEarly
          ? ['Invoice integrity: not assessed (fraud analysis unavailable) — the document has not been checked for forgery or tampering.']
          : []),
      ],
      recommendation: INSUFFICIENT_LEVEL.recommendation,
      components: {
        categoryRisk: null, ageCurve: null, coverageWindow: null,
        reliability: null, dataConfidence: null,
      },
      repairContext: null,
      computedAt: recordedAt,
      riskLastCalculatedAt: recordedAt,
    };
  }

  // ── Date/warranty math ─────────────────────────────────────────────────────
  // NOTE: daysBetween(a, b) returns (b - a) in days.
  let daysUsed = null; // days since purchase (positive when purchase is in the past)
  let totalWarrantyDays = null;
  let daysRemaining = null; // days of coverage left (positive while covered)
  let warrantyEndIso = null;

  if (purchaseDate && durationMonths) {
    const purchase = new Date(purchaseDate);
    if (!Number.isNaN(purchase.getTime())) {
      // Canonical warranty-end computation (month-end safe, LOCAL time).
      const expiry = warrantyEndDate(purchase, durationMonths);
      if (expiry) {
        daysUsed = daysBetween(purchase, referenceDate);
        totalWarrantyDays = daysBetween(purchase, expiry);
        daysRemaining = daysBetween(referenceDate, expiry);
        warrantyEndIso = toISODateOnly(expiry);
      }
    }
  }

  const repairData = getRepairCostData(category);

  // ── FACTOR 1: WARRANTY REMAINING ───────────────────────────────────────────
  {
    let contribution;
    let severity;
    let explanation;
    let evidence = null;

    if (daysRemaining == null) {
      contribution = 20;
      severity = 'medium';
      explanation = 'Warranty term or purchase date unknown — remaining coverage cannot be assessed.';
      riskWarnings.push('Warranty coverage could not be assessed (missing purchase date or warranty term).');
    } else if (daysRemaining <= 0) {
      contribution = 45;
      severity = 'high';
      explanation = `Warranty expired ${Math.abs(daysRemaining)} days ago — no manufacturer coverage remains.`;
      evidence = warrantyEndIso ? `Warranty end: ${warrantyEndIso}` : null;
    } else {
      const pct = daysRemaining / totalWarrantyDays;
      const pct1 = parseFloat((pct * 100).toFixed(1));
      if (pct > 0.5) {
        contribution = 0;
        severity = 'none';
        explanation = `${daysRemaining} days remaining of ${totalWarrantyDays} total days (${pct1}% remaining) — full coverage.`;
      } else if (pct > 0.25) {
        contribution = 10;
        severity = 'low';
        explanation = `${daysRemaining} days of warranty remain (${pct1}% of term) — adequate coverage.`;
      } else if (pct > 0.1) {
                contribution = 20;
        severity = 'medium';
        explanation = `Only ${daysRemaining} days of warranty remain (${pct1}% of term) — report defects soon.`;
      } else {
                contribution = 30;
        severity = 'high';
        explanation = `Warranty expiring imminently — ${daysRemaining} days left (${pct1}% of term).`;
      }
      evidence = `Warranty end: ${warrantyEndIso}`;
      if (daysRemaining > 0 && daysRemaining <= 30) {
        riskWarnings.push(`Warranty expires in ${daysRemaining} days — file any claims before ${warrantyEndIso}.`);
      }
    }

    riskFactors.push({
      name: 'Warranty remaining',
      contribution,
      severity,
      explanation,
      evidence,
      daysRemaining,
      totalWarrantyDays,
      warrantyEndIso,
    });
    riskEvidence.push({
      type: 'calculated',
      description: evidence || explanation,
      source: 'warranty-math',
      recordedAt,
    });
  }

  // ── FACTOR 2: PRODUCT AGE ──────────────────────────────────────────────────
  {
    let contribution;
    let severity;
    let explanation;
    let evidence = null;

    if (daysUsed == null) {
      contribution = 20;
      severity = 'medium';
      explanation = 'Purchase date unknown — product age cannot be assessed.';
      riskWarnings.push('Product age could not be assessed (missing purchase date).');
    } else if (daysUsed < 0) {
      contribution = 10;
      severity = 'medium';
      explanation = `Purchase date (${purchaseDate}) is in the future relative to the reference date — possible data-entry error.`;
      riskWarnings.push('Purchase date is in the future relative to today — verify the date.');
    } else if (daysUsed <= 90) {
      contribution = 5;
      severity = 'low';
      explanation = `Purchased ${daysUsed} days ago — early life; most category failures surface later.`;
    } else if (totalWarrantyDays != null && daysUsed <= totalWarrantyDays * 0.75) {
      contribution = 0;
      severity = 'none';
      explanation = `${daysUsed} days in use (${Math.round((daysUsed / totalWarrantyDays) * 100)}% of warranty term used) — age risk is low.`;
    } else if (totalWarrantyDays != null && daysUsed <= totalWarrantyDays) {
      contribution = 15;
      severity = 'medium';
      explanation = `${daysUsed} days in use — within warranty but nearing the end of the term; wear risk rising.`;
    } else if (totalWarrantyDays != null) {
      const monthsExpired = Math.floor(Math.max(0, daysUsed - totalWarrantyDays) / 30);
      contribution = Math.min(15, 5 + monthsExpired);
      severity = 'low';
      explanation = `${daysUsed} days in use, ${monthsExpired} months past the warranty term — age adds modestly to failure likelihood.`;
    } else {
      contribution = 10;
      severity = 'low';
      explanation = `${daysUsed} days in use — age risk moderate without a known warranty term.`;
    }
    if (daysUsed != null) evidence = `Purchase date: ${purchaseDate} (${daysUsed} days ago)`;

    riskFactors.push({
      name: 'Product age',
      contribution,
      severity,
      explanation,
      evidence,
    });
    riskEvidence.push({
      type: 'calculated',
      description: evidence || explanation,
      source: 'age-math',
      recordedAt,
    });
  }

  // ── FACTOR 3: CATEGORY REFERENCE ───────────────────────────────────────────
  {
    const rate = repairData?.historicalFailureRate ?? 0.1;
    const contribution = Math.max(-5, Math.round((rate - 0.1) * 200));
    const explanation = category
      ? `Category "${category}" has a historical failure rate of ${(rate * 100).toFixed(0)}% within the warranty period${contribution > 0 ? ' — above the 10% baseline' : contribution < 0 ? ' — below the 10% baseline' : ' — at the 10% baseline'}.`
      : 'Category unknown — no category reference applied.';
    const severity = 'low';

    if (category) riskWarnings.push('Category risk based on category-level statistics, not this specific unit.');
    riskEvidence.push({
      type: 'database',
      description: `Category reference: ${category || 'unknown'} — historical failure rate ${(rate * 100).toFixed(0)}% within warranty period.`,
      source: 'repair-cost-db',
      recordedAt,
    });
    riskFactors.push({
      name: 'Category reference',
      contribution,
      severity,
      explanation,
      evidence: category ? `Historical failure rate: ${(rate * 100).toFixed(0)}%` : null,
    });
  }

  // ── FACTOR 4: INVOICE INTEGRITY (fraud signals — fraud runs first) ─────────
  {
    // "Assessed" only when the fraud engine actually ran (the pipeline runs
    // it BEFORE risk). A missing fraud report means integrity was NOT
    // checked — do not claim it was (extraction quality != authenticity).
    const fraudRan = Boolean(
      fraudReport && (
        Array.isArray(fraudReport.signals) ||
        Number.isFinite(Number(fraudReport.fraudScore))
      )
    );
    const signals = Array.isArray(fraudReport?.signals) ? fraudReport.signals : [];
    const maxSeverity = signals.reduce(
      (m, s) => Math.max(m, Number.isFinite(s?.severity) ? s.severity : 0),
      fraudReport?.fraudScore && fraudReport.fraudScore > 0 ? fraudReport.fraudScore / 100 : 0
    );
    const contribution = Math.round(clamp(maxSeverity, 0, 1) * 62.5);
    const severity = contribution >= 40 ? 'high' : contribution >= 20 ? 'medium' : 'low';
    let explanation;
    if (!fraudRan) {
      explanation = 'Invoice integrity not assessed — fraud analysis did not run.';
      riskWarnings.push('Invoice integrity: not assessed (fraud analysis unavailable) — the document has not been checked for forgery or tampering.');
    } else if (signals.length) {
      explanation = `${signals.length} integrity flag(s) detected — ${signals.map((s) => s.type?.replace(/_/g, ' ').toLowerCase() || s.detail).slice(0, 3).join('; ')}.`;
    } else {
      explanation = 'Integrity check passed — no fraud signals detected on this invoice.';
    }

    if (!fraudRan) {
      riskEvidence.push({
        type: 'calculated',
        description: 'Invoice integrity: not assessed — no fraud analysis was run on this document.',
        source: 'fraud-engine',
        recordedAt,
      });
    } else {
      signals.slice(0, 3).forEach((s) => {
        riskEvidence.push({
          type: s.type || 'fraud-signal',
          description: s.detail || `${s.type} flag (severity ${s.severity ?? '?'}).`,
          source: 'fraud-engine',
          severity: s.severity ?? null,
          recordedAt,
        });
      });
      if (signals.length === 0) {
        riskEvidence.push({
          type: 'calculated',
          description: 'Invoice integrity checked — no flags detected.',
          source: 'fraud-engine',
          recordedAt,
        });
      }
    }

    riskFactors.push({
      name: 'Invoice integrity',
      contribution,
      severity,
      explanation,
      evidence: !fraudRan ? 'not assessed' : signals.length ? `${signals.length} flag(s)` : 'no flags',
    });
  }

  // ── FACTOR 5: DATA CONFIDENCE ──────────────────────────────────────────────
  {
    const conf = Number.isFinite(parseFloat(overallConf)) ? clamp(parseFloat(overallConf), 0, 1) : 0.5;
    const contribution = Math.round((1 - conf) * 60);
    const severity = contribution >= 25 ? 'high' : contribution >= 10 ? 'medium' : 'low';
    const explanation = overallConf == null
      ? 'No extraction confidence available — assumed 50%.'
      : `Extraction confidence ${(conf * 100).toFixed(0)}%${conf < 0.55 ? ' — low confidence in the extracted fields' : ''}.`;

    if (overallConf == null) riskWarnings.push('No extraction confidence was recorded for this invoice.');
    if (conf < 0.55) riskWarnings.push('Extraction confidence is low — verify the extracted fields manually.');

    riskEvidence.push({
      type: 'calculated',
      description: `Extraction confidence: ${Math.round(conf * 100)}%`,
      source: 'extraction',
      recordedAt,
    });
    riskFactors.push({
      name: 'Data confidence',
      contribution,
      severity,
      explanation,
      evidence: `Extraction confidence: ${(conf * 100).toFixed(0)}%`,
    });
  }

  // ── FACTOR 6 (optional): RECALLS & ADVISORIES (internet research) ──────────
  let researchFactor = null;
  if (Array.isArray(externalEvidence) && externalEvidence.length > 0) {
    let maxContribution = 0;
    let strongest = null;
    externalEvidence.forEach((item) => {
      const text = `${item.title ?? ''} ${item.snippet ?? ''} ${item.url ?? ''}`.toLowerCase();
      let sev = 0.2;
      if (/(recall|voluntary.{0,20}removal|stop.{0,10}sale|safety.{0,10}(alert|hazard))/.test(text)) sev = 0.25;
      else if (/(service bulletin|service notice|advisory|advisories)/.test(text)) sev = 0.3;
      else if (/(defect|faulty|flaw|reliability|known issue|lawsuit|class action|battery fire|overheat|bricked)/.test(text)) sev = 0.6;
      const c = Math.round(sev * 62.5);
      if (c > maxContribution) { maxContribution = c; strongest = item; }
    });
    if (maxContribution > 0) {
      researchFactor = {
        name: 'Recalls & advisories',
        contribution: maxContribution,
        severity: maxContribution >= 25 ? 'high' : 'medium',
        explanation: strongest
          ? `Internet research flagged relevant results (${strongest.title ?? 'see evidence'}) — investigate before purchase or service decisions.`
          : 'Internet research flagged relevant results.',
        evidence: `${externalEvidence.length} result(s)`,
      };
      riskWarnings.push('Internet research found recall/advisory/reliability results for this product — investigate before relying on warranty support.');
      externalEvidence.slice(0, 3).forEach((item) => {
        riskEvidence.push({
          type: 'research',
          description: `${item.title || 'Untitled'}${item.url ? ` (${item.url})` : ''}`,
          source: 'web-research',
          category: item.category || 'other',
          recordedAt,
        });
      });
    }
  }

  // ── Aggregate ──────────────────────────────────────────────────────────────
  if (researchFactor) riskFactors.push(researchFactor);

  const total = Math.round(clamp(riskFactors.reduce((s, f) => s + (f.contribution || 0), 0), 0, 100));
  // Single canonical classification — see ./riskClassification.js.
  const cls = classifyRiskLevel(total) || { level: 'LOW', label: 'Low' };

  // Dynamic explanation + recommendation built from the ACTUAL dominant factors.
  const riskReason = buildRiskReason({
    level: cls.level,
    label: cls.label,
    riskFactors,
    fraudReport,
    warrantyEndIso,
    daysRemaining,
  });
  const riskRecommendation = buildRiskRecommendation({ riskFactors, fraudReport, daysRemaining });

  // Confidence: weighted by how much of the evidence picture is present.
  const presentBlocks = ev.blocks.filter((b) => b.present).length;
  const blockConf = Number.isFinite(parseFloat(overallConf))
    ? clamp(parseFloat(overallConf), 0, 1)
    : 0.5;
  const riskConfidence = round(clamp(blockConf * (0.5 + 0.5 * (presentBlocks / 5)), 0.05, 1));

  return {
    product,
    brand,
    category,
    riskScore: total,
    riskLevel: cls.level,
    riskLevelLabel: cls.label,
    riskReason,
    riskConfidence,
    riskFactors,
    riskEvidence,
    riskWarnings,
    recommendation: riskRecommendation || riskRecommendationFor(cls.level),
    components: {
      categoryRisk: riskFactors.find((f) => f.name === 'Category reference')?.contribution ?? null,
      ageCurve: riskFactors.find((f) => f.name === 'Product age')?.contribution ?? null,
      coverageWindow: riskFactors.find((f) => f.name === 'Warranty remaining')?.contribution ?? null,
      reliability: researchFactor?.contribution ?? null,
      dataConfidence: riskFactors.find((f) => f.name === 'Data confidence')?.contribution ?? null,
    },
    repairContext: {
      medianRepairCost: repairData?.medianRepairCost ?? null,
      reliabilityScore: repairData?.reliabilityScore ?? null,
      historicalFailureRate: repairData?.historicalFailureRate ?? null,
      replacementCostMultiple: repairData?.replacementCostMultiple ?? null,
    },
    computedAt: recordedAt,
    riskLastCalculatedAt: recordedAt,
  };
}

export default { computeProductRisk, INSUFFICIENT_LEVEL };
