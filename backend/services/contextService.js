/**
 * contextService.js
 *
 * Deterministic context layer for the AI bridge.
 *
 * RULE: Qwen is the language/reasoning interface only. Every factual
 * value Qwen sees about the user's products comes from this module —
 * computed from the user's stored Firestore product records with plain
 * arithmetic (no model inference, no invention).
 *
 * Responsibilities:
 *  - computeWarrantyStatus: expiry math from purchaseDate + warrantyMonths
 *  - pruneProduct: reduce a Firestore product doc to the fields Qwen may
 *    reference (keeps prompts small — no giant payloads)
 *  - buildContext: assemble the user's product snapshot for the prompt
 */

/** Same deterministic status logic as the frontend detail page (UTC day math). */
export function computeWarrantyStatus(product, now = new Date()) {
  const purchaseDate = product?.purchaseDate;
  const months = Number(product?.warrantyMonths);
  if (
    typeof purchaseDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate) ||
    !Number.isFinite(months) ||
    months <= 0
  ) {
    return { status: 'unknown', expiryDate: null, daysRemaining: null };
  }

  const [y, m, d] = purchaseDate.split('-').map(Number);
  const expiryUtc = new Date(Date.UTC(y, m - 1 + months, d));
  const nowUtcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysRemaining = Math.floor((expiryUtc.getTime() - nowUtcDay) / msPerDay);
  const expiryDate = expiryUtc.toISOString().split('T')[0];

  if (daysRemaining < 0) return { status: 'expired', expiryDate, daysRemaining };
  if (daysRemaining <= 30) return { status: 'expiring', expiryDate, daysRemaining };
  return { status: 'active', expiryDate, daysRemaining };
}

/** Reduces a product document to the fields the assistant may reference. */
export function pruneProduct(product) {
  if (!product || typeof product !== 'object') return null;
  const warranty = computeWarrantyStatus(product);
  return {
    id: product.id || null,
    productName: product.productName || null,
    brand: product.brand || null,
    category: product.category || null,
    purchaseDate: product.purchaseDate || null,
    warrantyMonths: Number(product.warrantyMonths) || null,
    invoiceNumber: product.invoiceNumber || null,
    serialNumber: product.serialNumber || null,
    seller: product.seller || null,
    price: product.price || null,
    invoiceIssue: product.invoiceIssue || null,
    riskLevel: product.riskLevel || null,
    riskScore: Number(product.riskScore) ?? null,
    fraudScore: Number(product.fraudScore) ?? null,
    fraudSignals: Array.isArray(product.fraudSignals) ? product.fraudSignals.slice(0, 6) : [],
    warrantyStatus: warranty.status,
    warrantyExpiryDate: warranty.expiryDate,
    warrantyDaysRemaining: warranty.daysRemaining,
    repairHistory: Array.isArray(product.repairHistory)
      ? product.repairHistory.slice(0, 5).map((r) => ({
          date: r?.date || null,
          description: r?.description || r?.issueType || null,
          cost: r?.cost ?? null,
        }))
      : [],
  };
}

/**
 * Builds the compact product snapshot used in the system prompt.
 * @param {Array<object>} products
 * @param {Date} [now]
 * @returns {{ products: Array<object>, summary: { total: number, expiringSoon: number, highRisk: number, flaggedInvoices: number } }}
 */
export function buildContext(products, now = new Date()) {
  const pruned = (Array.isArray(products) ? products : [])
    .map(pruneProduct)
    .filter(Boolean);

  const summary = {
    total: pruned.length,
    expiringSoon: pruned.filter((p) => p.warrantyStatus === 'expiring').length,
    highRisk: pruned.filter((p) => ['HIGH', 'CRITICAL'].includes(p.riskLevel) || p.riskScore >= 65).length,
    flaggedInvoices: pruned.filter(
      (p) => p.fraudScore >= 40 || p.fraudSignals.length > 0
    ).length,
  };

  return { products: pruned, summary };
}

/** Formats the current date for the prompt (local machine time). */
export function todayLabel(now = new Date()) {
  return now.toISOString().split('T')[0];
}

export default {
  computeWarrantyStatus,
  pruneProduct,
  buildContext,
  todayLabel,
};
