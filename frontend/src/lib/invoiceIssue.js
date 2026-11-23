const messages = {
  SYNTHETIC_DOCUMENT: 'This looks like a sample invoice. Ask the seller for the original.',
  FUTURE_PURCHASE_DATE: 'The purchase date is in the future. Check the original invoice.',
  IMPLAUSIBLE_PURCHASE_DATE: 'The purchase date looks unusual. Check the year.',
  EXCESSIVE_WARRANTY_DURATION: 'The warranty looks unusually long. Confirm the term with the seller.',
  SUSPICIOUSLY_SHORT_WARRANTY: 'The warranty looks unusually short. Check the stated term.',
  SHORT_INVOICE_NUMBER: 'The invoice number looks incomplete.',
  REPEATING_INVOICE_NUMBER: 'The invoice number has an unusual repeating pattern.',
  SUSPICIOUS_SERIAL_NUMBER: 'The serial number looks like a placeholder.',
  SHORT_SERIAL_NUMBER: 'The serial number looks incomplete.',
  SELLER_PLATFORM_CONFLICT: 'The seller details conflict with the marketplace on the invoice.',
  PLATFORM_INVOICE_MISMATCH: 'The invoice number format looks unusual for this marketplace.',
  DUPLICATE_INVOICE_NUMBER: 'Another record uses the same invoice number.',
  OCR_SUBSTITUTION_CONCENTRATION: 'Some characters were hard to read. Check the original invoice.',
};

export function invoiceIssue(product) {
  if (product.invoiceAssessment) return [...product.invoiceAssessment.issues, ...product.invoiceAssessment.notes][0] || product.invoiceAssessment.status;
  const signals = product.fraudSignals ?? product.fraud?.signals ?? [];
  const main = signals.find(s => s.type === 'SYNTHETIC_DOCUMENT') ||
    [...signals].sort((a, b) => b.severity - a.severity)[0];
  if (main || (product.fraudWarning && product.fraudWarning !== 'CLEAN')) {
    return messages[main?.type] || 'Some invoice details look inconsistent. Check the original.';
  }
  if (product.fraudWarning === 'CLEAN' || product.fraudScore === 0) {
    return 'No original assessment saved. Update the invoice to check its purchase details.';
  }
  return 'Invoice checks unavailable. Scan an invoice to check for issues.';
}

