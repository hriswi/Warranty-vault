/**
 * warrantyStatus.js
 *
 * SINGLE canonical warranty status / timeline computation for the UI.
 *
 * Every page (Dashboard, Products, Expiring, Product detail) must use
 * getWarrantyTimeline() instead of re-implementing expiry math, so the
 * warranty end date is identical everywhere — including the risk engine
 * evidence ("Warranty end: ...") and the AI assistant's timeline.
 *
 * Uses dateUtils.addMonths (month-end safe, e.g. Jan 31 + 1 month ->
 * Feb 28/29) and dateUtils.toISODateOnly (LOCAL time, so the ISO string
 * never shifts back a day via UTC conversion).
 */
import { addMonths, daysBetween, toISODateOnly } from './engine/utils/dateUtils.js';

/**
 * @param {object} product            { purchaseDate: 'YYYY-MM-DD', warrantyMonths: number }
 * @param {Date}   [referenceDate]    Defaults to today.
 * @returns {object} {
 *   status: 'active' | 'expiring' | 'expired' | 'unknown',
 *   days,               // |daysRemaining| — always >= 0
 *   daysRemaining,      // signed: negative when expired
 *   daysUsed, totalDays, percentUsed,
 *   expiry,             // Date | null
 *   expiryIso,          // 'YYYY-MM-DD' local | null
 *   isExpired, isExpiring
 * }
 */
export function getWarrantyTimeline(product, referenceDate = new Date()) {
  if (!product || !product.purchaseDate || !product.warrantyMonths) {
    return {
      status: 'unknown',
      days: null,
      daysRemaining: null,
      daysUsed: null,
      totalDays: null,
      percentUsed: 0,
      expiry: null,
      expiryIso: null,
      isExpired: false,
      isExpiring: false,
    };
  }

  const purchase = new Date(product.purchaseDate);
  const expiry = addMonths(purchase, product.warrantyMonths);
  const totalDays = daysBetween(purchase, expiry);
  const daysUsed = Math.max(0, daysBetween(purchase, referenceDate));
  const daysRemaining = daysBetween(referenceDate, expiry);
  const percentUsed = totalDays > 0
    ? Math.max(0, Math.min(100, Math.round((daysUsed / totalDays) * 100)))
    : 0;

  let status;
  if (daysRemaining < 0) status = 'expired';
  else if (daysRemaining <= 30) status = 'expiring';
  else status = 'active';

  return {
    status,
    days: Math.abs(daysRemaining),
    daysRemaining,
    daysUsed,
    totalDays,
    percentUsed,
    expiry,
    expiryIso: toISODateOnly(expiry),
    isExpired: daysRemaining < 0,
    isExpiring: daysRemaining >= 0 && daysRemaining <= 90,
  };
}

export default getWarrantyTimeline;
