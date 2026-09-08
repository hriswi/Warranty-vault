/**
 * Maps parsed invoice intelligence output to Add Product form fields.
 * Keeps category constrained to UI options and normalizes dates/prices.
 *
 * Deterministic fallback: when the extraction pipeline leaves
 * productName/brand/category empty, supplementMissingProductFields
 * fills them from the raw OCR text (classifier + product-table row
 * heuristic) — never from canned/placeholder values.
 */

import { classifyProduct } from './engine/classifier/productClassifier.js';
import { CATEGORIES } from './engine/classifier/productDatabase.js';

const HTML_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize parser purchaseDate to YYYY-MM-DD for <input type="date">.
 * Parser already returns ISO strings; this is defensive for other shapes.
 */
export function normalizePurchaseDateForInput(value) {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (HTML_DATE_RE.test(trimmed)) return trimmed;
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return '';
}

/**
 * Strip currency symbols/separators; preserve meaningful decimals.
 * e.g. "₹72,000" → "72000", "Rs. 72,000.00" → "72000"
 */
export function normalizePurchasePriceForInput(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  if (typeof value !== 'string') return '';

  let s = value.trim();
  s = s.replace(/^(rs\.?|inr|usd|eur|gbp)\s*/i, '');
  s = s.replace(/[₹$€£,\s]/g, '');
  if (!s) return '';

  const num = parseFloat(s);
  if (!Number.isFinite(num) || num < 0) return '';

  if (Number.isInteger(num)) return String(Math.trunc(num));
  return String(num);
}

/**
 * Deterministic category mapping: AI/OCR category string → one of the
 * real CategorySelect options. Never guesses — every mapping comes from
 * the exact option values, the synonym table, or the 'Other Electronics'
 * catch-all.
 */
const CATEGORY_SYNONYMS = [
  // [keyword, canonical] — matched longest-first (see resolveCategoryForForm),
  // so "headphone" beats "phone" and "earbuds" beats "buds" substring hits.
  ['laptop', CATEGORIES.LAPTOP], ['notebook', CATEGORIES.LAPTOP], ['ultrabook', CATEGORIES.LAPTOP], ['macbook', CATEGORIES.LAPTOP], ['chromebook', CATEGORIES.LAPTOP],
  ['smartphone', CATEGORIES.SMARTPHONE], ['cellphone', CATEGORIES.SMARTPHONE], ['mobile phone', CATEGORIES.SMARTPHONE], ['android phone', CATEGORIES.SMARTPHONE], ['iphone', CATEGORIES.SMARTPHONE], ['phone', CATEGORIES.SMARTPHONE], ['mobile', CATEGORIES.SMARTPHONE],
  ['tablet', CATEGORIES.TABLET], ['ipad', CATEGORIES.TABLET],
  ['television', CATEGORIES.TELEVISION], ['smart tv', CATEGORIES.TELEVISION], ['led tv', CATEGORIES.TELEVISION], ['qled', CATEGORIES.TELEVISION], ['oled', CATEGORIES.TELEVISION], ['tv', CATEGORIES.TELEVISION],
  ['refrigerator', CATEGORIES.REFRIGERATOR], ['fridge', CATEGORIES.REFRIGERATOR], ['double door', CATEGORIES.REFRIGERATOR], ['frost free', CATEGORIES.REFRIGERATOR],
  ['air conditioner', CATEGORIES.AIR_CONDITIONER], ['split ac', CATEGORIES.AIR_CONDITIONER], ['window ac', CATEGORIES.AIR_CONDITIONER], ['inverter ac', CATEGORIES.AIR_CONDITIONER], ['ac', CATEGORIES.AIR_CONDITIONER],
  ['smartwatch', CATEGORIES.SMARTWATCH], ['smart watch', CATEGORIES.SMARTWATCH], ['apple watch', CATEGORIES.SMARTWATCH], ['fitness band', CATEGORIES.SMARTWATCH], ['fitness tracker', CATEGORIES.SMARTWATCH], ['wearable', CATEGORIES.SMARTWATCH], ['watch', CATEGORIES.SMARTWATCH], ['band', CATEGORIES.SMARTWATCH],
  ['headphones', CATEGORIES.AUDIO_DEVICE], ['headphone', CATEGORIES.AUDIO_DEVICE], ['wireless earbuds', CATEGORIES.AUDIO_DEVICE], ['earbuds', CATEGORIES.AUDIO_DEVICE], ['earbud', CATEGORIES.AUDIO_DEVICE], ['earphone', CATEGORIES.AUDIO_DEVICE], ['earphones', CATEGORIES.AUDIO_DEVICE],
  ['bluetooth speaker', CATEGORIES.AUDIO_DEVICE], ['soundbar', CATEGORIES.AUDIO_DEVICE], ['noise cancelling', CATEGORIES.AUDIO_DEVICE], ['speaker', CATEGORIES.AUDIO_DEVICE], ['audio', CATEGORIES.AUDIO_DEVICE],
  ['playstation', CATEGORIES.GAMING_CONSOLE], ['nintendo switch', CATEGORIES.GAMING_CONSOLE], ['gaming console', CATEGORIES.GAMING_CONSOLE], ['xbox', CATEGORIES.GAMING_CONSOLE], ['ps5', CATEGORIES.GAMING_CONSOLE], ['ps4', CATEGORIES.GAMING_CONSOLE], ['console', CATEGORIES.GAMING_CONSOLE],
  ['washing machine', CATEGORIES.WASHING_MACHINE], ['front load', CATEGORIES.WASHING_MACHINE], ['top load', CATEGORIES.WASHING_MACHINE], ['washing', CATEGORIES.WASHING_MACHINE],
  ['microwave', CATEGORIES.MICROWAVE], ['convection oven', CATEGORIES.MICROWAVE], ['otg', CATEGORIES.MICROWAVE], ['oven', CATEGORIES.MICROWAVE],
  ['camera', CATEGORIES.CAMERA], ['dslr', CATEGORIES.CAMERA], ['mirrorless', CATEGORIES.CAMERA], ['action camera', CATEGORIES.CAMERA], ['webcam', CATEGORIES.CAMERA],
  ['printer', CATEGORIES.PRINTER], ['inkjet', CATEGORIES.PRINTER], ['laserjet', CATEGORIES.PRINTER], ['scanner', CATEGORIES.PRINTER],
  ['monitor', CATEGORIES.MONITOR], ['curved monitor', CATEGORIES.MONITOR], ['display', CATEGORIES.MONITOR],
  ['keyboard', CATEGORIES.KEYBOARD_MOUSE], ['mechanical keyboard', CATEGORIES.KEYBOARD_MOUSE], ['wireless mouse', CATEGORIES.KEYBOARD_MOUSE], ['mouse', CATEGORIES.KEYBOARD_MOUSE],
  ['power bank', CATEGORIES.POWER_BANK], ['portable charger', CATEGORIES.POWER_BANK], ['power brick', CATEGORIES.POWER_BANK], ['charger', CATEGORIES.POWER_BANK],
  ['vacuum cleaner', CATEGORIES.VACUUM_CLEANER], ['robot vacuum', CATEGORIES.VACUUM_CLEANER], ['cordless vacuum', CATEGORIES.VACUUM_CLEANER],
  ['water purifier', CATEGORIES.WATER_PURIFIER], ['ro purifier', CATEGORIES.WATER_PURIFIER], ['purifier', CATEGORIES.WATER_PURIFIER],
];

function normalizeCategoryToken(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Only use category when it maps to a supported dropdown option.
 * Matching order: exact option → synonym table (longest keyword first)
 * → keyword containment → "Other Electronics" catch-all. The result is
 * always a valid option value (or '' when there is nothing to map).
 */
export function resolveCategoryForForm(parsedCategory, allowedCategories) {
  if (!parsedCategory || !allowedCategories?.length) return '';
  const target = normalizeCategoryToken(parsedCategory);
  if (!target) return '';

  const options = allowedCategories.map((c) => String(c));

  const exact = options.find((c) => normalizeCategoryToken(c) === target);
  if (exact) return exact;

  const synonyms = [...CATEGORY_SYNONYMS].sort((a, b) => b[0].length - a[0].length);
  const canonicalExists = (v) => options.some((c) => c === v);

  for (const [keyword, canonical] of synonyms) {
    if (target === keyword) return canonicalExists(canonical) ? canonical : 'Other Electronics';
  }

  for (const [keyword, canonical] of synonyms) {
    if (target.includes(keyword)) return canonicalExists(canonical) ? canonical : 'Other Electronics';
  }

  return 'Other Electronics';
}

/**
 * Deterministic supplement for the product identity fields. Called when
 * the extraction pipeline (Qwen or the local parser) left
 * productName/brand/category empty. Uses:
 *   1. the invoice's product-table row: "Product / Brand / Model / Qty /
 *      Unit Price / Total" header followed by the row columns
 *   2. classifyProduct() on the raw OCR text (keyword/model/brand DB)
 *   3. a conservative first-content-line heuristic
 * Only empty fields are ever filled; existing values are never touched.
 */
export function supplementMissingProductFields(invoice, rawText, allowedCategories = []) {
  if (!invoice || typeof invoice !== 'object') return invoice;
  const out = { ...invoice };
  const has = (v) => v != null && String(v).trim() !== '';
  const needName = !has(out.productName);
  const needBrand = !has(out.brand);
  const needCategory = !has(out.category);
  if (!needName && !needBrand && !needCategory) return out;

  const text = String(rawText || '');

  // 1) Product-table row: header "Product Brand Model Qty Unit Price Total"
  //    The browser OCR output lays each column on its own line
  //    (Product / Brand / Model / Qty / Unit Price / Total, then the
  //    row: sku / brand / model / qty / unit price / total). The
  //    text-layer variant may also merge them onto one line.
  if (needName || needBrand) {
    const headerRe = /product[\s]*\n?[\s]*brand[\s]*\n?[\s]*model/i;
    const m = headerRe.exec(text);
    if (m) {
      const after = text.slice(m.index + m[0].length);
      const lines = after.split('\n').map((s) => s.trim()).filter(Boolean);
      const isHeaderCol = (s) => /^(qty|quantity|unit|price|total|rate|amount|sku|part|desc)/i.test(s);
      const row = lines.filter((s) => !isHeaderCol(s));
      const [sku, brand, model] = row;

      if (needBrand && !has(out.brand) && brand && brand !== sku && /[A-Za-z]{2,}/.test(brand)) {
        out.brand = brand;
      }
      if (needName && !has(out.productName)) {
        if (model && sku !== model && model !== brand) {
          const brandPart = has(out.brand) ? out.brand : '';
          out.productName = [brandPart, model].filter(Boolean).join(' ').trim();
        } else if (sku && !/^[\d.,₹$€£\s]+$/.test(sku) && sku !== brand) {
          out.productName = sku;
        }
      }
    }
  }

  // 2) Classifier cross-check on the raw OCR text
  if (needBrand || needCategory) {
    try {
      const cls = classifyProduct(text);
      if (needCategory && !has(out.category) && cls?.category) {
        out.category = resolveCategoryForForm(cls.category, allowedCategories);
      }
      if (needBrand && !has(out.brand) && cls?.brand && Number(cls.brandConfidence) >= 0.6) {
        out.brand = String(cls.brand);
      }
    } catch (_) {
      // classifier is informational — never fail the mapping because of it
    }
  }

  // 3) Conservative last-resort: first content line that looks like a product
  if (needName && !has(out.productName)) {
    const labelRe = /^(invoice|tax|bill|seller|gst|serial|purchase|warranty|subtotal|grand|total|thank|synthetic|product|brand|model|qty|unit|price|date|no\.?|gstin|amount|customer|bill to|shipping|address|terms|paid|due|payment|balance|contact|phone|email|page)/i;
    for (const line of text.split('\n')) {
      const s = line.trim();
      if (s.length < 4 || s.length > 80) continue;
      if (!/[a-z]/.test(s)) continue; // all-caps lines are usually headers/store names
      if (labelRe.test(s)) continue;
      if (/^[\d\s.,₹$€£%()-]+$/.test(s)) continue;
      if (/\d{4}-\d{2}-\d{2}/.test(s)) continue;
      if (/rs\.?|₹|\$|€|£/i.test(s)) continue;
      out.productName = s;
      break;
    }
  }

  return out;
}

/**
 * Map normalized extraction data to form field values.
 * `force` bypasses user-edit protection (used after a fresh OCR run).
 * `rawText` enables the deterministic product-field supplement.
 */
export function mapInvoiceToFormFields(invoice, opts = {}) {
  if (!invoice) return {};

  const {
    allowedCategories = [],
    userEditedFields = new Set(),
    force = false,
    rawText = '',
  } = opts;

  const source = supplementMissingProductFields(invoice, rawText, allowedCategories);
  const patch = {};

  const assign = (formKey, value) => {
    if (!force && userEditedFields.has(formKey)) return;
    if (value != null && value !== '') patch[formKey] = value;
  };

  // Qwen/extractor returns these exact keys (see backend invoiceExtractionService).
  assign('productName', source.productName != null ? String(source.productName).trim() : '');
  assign('brand', source.brand != null ? String(source.brand).trim() : '');
  assign('category', resolveCategoryForForm(source.category, allowedCategories));
  assign('purchaseDate', normalizePurchaseDateForInput(source.purchaseDate));
  assign('warrantyMonths', source.warrantyMonths != null ? String(source.warrantyMonths) : '');
  assign('invoiceNumber', source.invoiceNumber != null ? String(source.invoiceNumber).trim() : '');
  assign('serialNumber', source.serialNumber != null ? String(source.serialNumber).trim() : '');
  assign('seller', source.seller != null ? String(source.seller).trim() : '');
  assign('price', normalizePurchasePriceForInput(source.purchasePrice ?? source.price));

  return patch;
}

export default { normalizePurchaseDateForInput, normalizePurchasePriceForInput, resolveCategoryForForm, supplementMissingProductFields, mapInvoiceToFormFields };
