/**
 * invoiceExtractionService.js
 *
 * Uses the local Qwen model (via qwenService) as the field-extraction
 * layer for invoice processing. OCR is done elsewhere (browser
 * Tesseract/pdf.js) — this service receives the RAW INVOICE TEXT and
 * returns a strict, validated JSON object.
 *
 * Contract with Qwen:
 *   - STRICT JSON ONLY (no markdown, no prose)
 *   - Use null for any value that genuinely cannot be determined
 *   - NEVER invent missing invoice data
 *   - Category is inferred from the product description/model when the
 *     invoice does not state one explicitly
 *   - purchasePrice is the FINAL amount payable (grand total after tax
 *     and discounts), not the subtotal or tax
 *
 * Failure handling:
 *   - malformed JSON, schema violations, or a reply that leaves the
 *     core product fields (productName/brand/category) null while the
 *     rest of the invoice was clearly parsed, trigger ONE retry with a
 *     corrective instruction
 *   - if both attempts fail → ExtractionError('EXTRACTION_INVALID_RESPONSE')
 *   - Qwen offline/timeout errors propagate as QwenError (503/504)
 */

import { chatComplete, QwenError } from './qwenService.js';

export const EXTRACTION_KEYS = Object.freeze([
  'productName',
  'brand',
  'category',
  'purchaseDate',
  'warrantyMonths',
  'invoiceNumber',
  'serialNumber',
  'seller',
  'purchasePrice',
  'currency',
]);

// Must mirror frontend/src/lib/engine/classifier/productDatabase.js CATEGORIES
// exactly — the frontend CategorySelect can only render these values.
const CATEGORY_HINTS = Object.freeze([
  'Smartphone', 'Laptop', 'Television', 'Refrigerator', 'Air Conditioner',
  'Smartwatch', 'Audio Device', 'Gaming Console', 'Washing Machine',
  'Microwave / Oven', 'Tablet', 'Camera', 'Printer', 'Monitor',
  'Keyboard / Mouse', 'Power Bank / Charger', 'Vacuum Cleaner',
  'Water Purifier', 'Other Electronics',
]);

export const EXTRACTION_SYSTEM_PROMPT = `
You are an invoice data extraction engine for a warranty management app.
Extract fields from the invoice text provided by the user.

Rules:
1. Only extract values that actually appear in the invoice text. NEVER invent, estimate, or guess a value. If a field cannot be determined from the text, set it to null.
2. productName: the product or line-item name, keeping the model identifier (e.g. "Lenovo ThinkPad E14 Gen 5").
3. brand: the brand or manufacturer if present.
4. category: if the invoice explicitly states a category, use it. Otherwise infer the best category from the product name/model (e.g. "Lenovo ThinkPad E14 Gen 5" -> "Laptop", "Sony WH-1000XM5" -> "Audio Device", "iPhone 15 Pro" -> "Smartphone"). The value MUST be one of: ${CATEGORY_HINTS.join(', ')}.
5. purchaseDate: the purchase/order date formatted as YYYY-MM-DD (e.g. "10-08-2026" -> "2026-08-10"). null if absent or unreadable.
6. warrantyMonths: the warranty duration in whole months ("24 months" -> 24, "1 year" -> 12, "2 yrs" -> 24). null if no warranty term is stated.
7. invoiceNumber, serialNumber, seller: exact values as printed, trimmed.
8. purchasePrice: the FINAL amount the customer actually pays — the grand total after tax and discounts. The invoice may list a subtotal, tax (GST/VAT), discounts, and a grand total; you MUST return the grand total / final payable amount. If only one amount exists, use it. Return the numeric value with no currency symbol and no thousands separators ("Rs. 84,960" -> 84960, "72,000.50" -> 72000.5). null if no price can be determined.
9. currency: the 3-letter ISO currency code inferred from the symbol or word (Rs./INR -> "INR", $ -> "USD", EUR/Euro -> "EUR", GBP/Pound -> "GBP"). null if none appears.
10. Output STRICT JSON ONLY: a single JSON object with EXACTLY these key names: ${EXTRACTION_KEYS.join(', ')}. No alternative key names such as product, product_name, product_name_or_model, item, manufacturer, company, product_category — they are NOT acceptable. Use null for unknown values. No markdown, no code fences, no explanations, no text before or after the JSON.
`.trim();

const RETRY_CORRECTION = `
Your previous answer was not a valid extraction JSON object (unparseable, failed schema validation, or left productName/brand/category null even though the invoice text clearly identifies a product).
Reply with ONLY the JSON object using the EXACT camelCase keys: {"productName": ..., "brand": ..., "category": ..., "purchaseDate": "YYYY-MM-DD" or null, "warrantyMonths": integer or null, "invoiceNumber": ..., "serialNumber": ..., "seller": ..., "purchasePrice": number or null, "currency": ...}.
Do NOT use alternative key names (product, product_name, manufacturer, item, product_category, ...). Use null ONLY for values that genuinely cannot be determined from the text. No markdown, no code fences.
`.trim();

export class ExtractionError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Tolerantly parses a Qwen reply into a JSON object:
 * strips markdown fences, keeps the first {...} block, parses.
 * Returns null when no parseable JSON object is present.
 */
export function parseStrictJson(reply) {
  if (typeof reply !== 'string') return null;
  let text = reply.trim();
  if (!text) return null;

  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
  if (fence) text = fence[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  text = text.slice(start, end + 1);

  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

/**
 * Maps possible AI aliases onto the canonical schema keys.
 * Explicit allow-list — keys not listed here are ignored, never guessed.
 */
export function resolveAliases(data) {
  const pick = (...names) => {
    for (const n of names) {
      const v = data[n];
      if (v != null && v !== '') return v;
    }
    return undefined;
  };
  return {
    productName: pick('productName', 'product', 'product_name', 'product_name_or_model', 'item'),
    brand: pick('brand', 'manufacturer', 'company'),
    category: pick('category', 'product_category', 'productCategory'),
    purchaseDate: pick('purchaseDate', 'purchase_date', 'purchaseDateValue'),
    warrantyMonths: pick('warrantyMonths', 'warranty_months', 'warrantyPeriod'),
    invoiceNumber: pick('invoiceNumber', 'invoice_number', 'invoice_no', 'invoiceId'),
    serialNumber: pick('serialNumber', 'serial_number', 'serialNo'),
    seller: pick('seller', 'vendor', 'retailer', 'merchant'),
    purchasePrice: pick('purchasePrice', 'purchase_price', 'price'),
    currency: pick('currency', 'currencyCode', 'currency_code'),
  };
}

/**
 * Schema validation + normalization. Returns
 * { ok: true, data: {...} } or { ok: false, problems: [...] }.
 * Every field is normalized to its expected type; null is legal.
 * Aliased key names are normalized to the canonical schema first.
 */
export function validateExtraction(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, problems: ['not-an-object'] };
  }
  const resolved = resolveAliases(data);
  const out = {};
  const problems = [];

  const str = (key) => {
    const v = resolved[key];
    if (v == null || v === '') { out[key] = null; return; }
    if (typeof v === 'number') { out[key] = String(v); return; }
    if (typeof v !== 'string') { problems.push(`${key}:not-a-string`); out[key] = null; return; }
    const s = v.trim();
    out[key] = s || null;
  };

  for (const key of ['productName', 'brand', 'category', 'invoiceNumber', 'serialNumber', 'seller', 'currency']) {
    str(key);
  }

  const d = resolved.purchaseDate;
  if (d != null && typeof d === 'string') {
    const m = d.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const dateOk = m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31
      && !Number.isNaN(Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`));
    if (dateOk) out.purchaseDate = `${m[1]}-${m[2]}-${m[3]}`;
    else { problems.push('purchaseDate:invalid'); out.purchaseDate = null; }
  } else {
    out.purchaseDate = null;
  }

  const w = resolved.warrantyMonths;
  if (w != null) {
    const n = Number(w);
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 1 && n <= 240) out.warrantyMonths = n;
    else { problems.push('warrantyMonths:invalid'); out.warrantyMonths = null; }
  } else {
    out.warrantyMonths = null;
  }

  const p = resolved.purchasePrice;
  if (p != null && p !== '') {
    let cleaned = String(p).trim().replace(/^(rs\.?|inr|usd|eur|gbp|jpy)\s*/i, '');
    cleaned = cleaned.replace(/[₹$€£,\s]/g, '');
    const n = Number(cleaned);
    if (Number.isFinite(n) && n > 0) out.purchasePrice = Math.round(n * 100) / 100;
    else { problems.push('purchasePrice:invalid'); out.purchasePrice = null; }
  } else {
    out.purchasePrice = null;
  }

  const hasValue = EXTRACTION_KEYS.some((k) => out[k] != null);
  if (!hasValue) problems.push('all-null');

  return problems.length === 0 ? { ok: true, data: out } : { ok: false, problems, data: out };
}

/**
 * True when the reply parsed the invoice (several fields present) but
 * left all three core product fields null — the classic "AI answered
 * with alternative key names or skipped the product row" failure.
 */
export function isMissingCoreFields(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.productName != null || data.brand != null || data.category != null) return false;
  const othersPresent = EXTRACTION_KEYS.filter((k) => data[k] != null).length;
  return othersPresent >= 3;
}

/**
 * Runs the extraction with ONE retry on invalid/incomplete output.
 * @param {string} text - raw invoice text (already OCR'd)
 * @returns {Promise<{data: object, attempts: number}>}
 */
export async function extractInvoice(text, { timeoutMs } = {}) {
  const effectiveTimeout = timeoutMs || Number(process.env.QWEN_EXTRACT_TIMEOUT_MS) || 90000;
  const userText = typeof text === 'string' ? text.slice(0, 200000) : '';

  const messages = [
    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
    { role: 'user', content: userText },
  ];

  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await chatComplete({
      messages,
      temperature: 0,
      maxTokens: 700,
      timeoutMs: effectiveTimeout,
    });

    console.log(`[extractInvoice] attempt ${attempt} raw Qwen reply: ${String(reply).slice(0, 2000)}`);

    const parsed = parseStrictJson(reply);
    const validated = parsed == null ? null : validateExtraction(parsed);
    if (parsed != null && validated.ok) {
      const incomplete = isMissingCoreFields(validated.data);
      if (!incomplete || attempt === 2) {
        return { data: validated.data, attempts: attempt };
      }
    }

    messages.push({ role: 'user', content: RETRY_CORRECTION });
  }

  throw new ExtractionError(
    'EXTRACTION_INVALID_RESPONSE',
    'Local AI returned invalid extraction data after two attempts.'
  );
}

export default { EXTRACTION_KEYS, extractInvoice, parseStrictJson, validateExtraction, resolveAliases, isMissingCoreFields, ExtractionError };
