import { assessInvoice, cleanTitle } from './invoiceEvidence.js';

function assessmentFor(product) {
  if (product.invoiceEvidence) return assessInvoice(product.invoiceEvidence);
  if (product.invoiceAssessment) return product.invoiceAssessment;
  const signals = product.fraudSignals || product.fraud?.signals || [];
  if (signals.some(signal => signal.type === 'SYNTHETIC_DOCUMENT')) {
    return {status: 'Needs checking', issues: ['This document is marked as a synthetic test invoice and is not valid proof of purchase.']};
  }
  return null;
}

export function riskCards(products) {
  return products.map(product => {
    const report = assessmentFor(product);
    const duplicate = product.invoiceNumber && products.some(other => other.id !== product.id &&
      other.invoiceNumber === product.invoiceNumber && other.seller === product.seller);
    const findings = [...(report?.issues || [])];
    if (duplicate) findings.push('Another record has the same invoice number and seller. Check whether both belong to this purchase.');
    const status = findings.length ? 'Needs checking' : report?.status || 'Awaiting assessment';
    return { product, report, findings, status };
  }).sort((a,b) => Number(b.status === 'Needs checking') - Number(a.status === 'Needs checking'));
}

export function answerRiskQuestion(query, products) {
  if (!/\b(?:highest[- ]risk|riskiest|most risky|suspicious invoices?|invoices? suspicious|which (?:products?|invoices?|devices?) need(?:s)? (?:checking|review))\b/i.test(query)) return null;
  if (!products.length) return 'You have no saved products yet. Add an invoice to check it.';
  const cards = riskCards(products);
  const flagged = cards.filter(card => card.status === 'Needs checking');
  if (flagged.length) {
    const first = flagged.find(card => card.findings.some(f => /synthetic test invoice/i.test(f))) || flagged[0];
    const name = cleanTitle(first.product.productName || '') || 'this invoice';
    return 'Review ' + name + ' first. ' + (first.findings[0] || 'Open its invoice assessment for details.') +
      (flagged.length > 1 ? ' Risk Analysis lists all ' + flagged.length + ' records that need checking.' : '');
  }
  const pending = cards.filter(card => !card.report).length;
  if (pending === cards.length) return 'Your saved products have no invoice assessments yet. Open a product, choose Edit invoice, then Reanalyze original invoice.';
  return 'None of your assessed invoices are flagged for review.' + (pending ? ' Still awaiting assessment: ' + pending + '.' : '');
}
