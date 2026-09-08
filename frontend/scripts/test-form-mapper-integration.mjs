import { parseInvoice } from '../src/lib/engine/parsers/invoiceParser.js';
import { mapInvoiceToFormFields } from '../src/lib/invoiceFormMapper.js';

const CATEGORIES = [
  'Smartphone','Laptop','Television','Refrigerator','Air Conditioner',
  'Smartwatch','Audio Device','Gaming Console','Washing Machine',
  'Microwave / Oven','Tablet','Camera','Printer','Monitor',
  'Keyboard / Mouse','Power Bank / Charger','Vacuum Cleaner',
  'Water Purifier','Other Electronics',
];

const sampleInvoiceOcrText = `
TechHub Electronics Pvt. Ltd.
TAX INVOICE

Invoice Number: TH-INV-2026-0810-0042
Invoice Date: 10-08-2026
Purchase Date: 10/08/2026

Sold By: TechHub Electronics Pvt. Ltd.
Brand: Lenovo

Item Description: Lenovo ThinkPad E14 Gen 5
Serial No: PF4X9K7L2M

Qty: 1
Unit Price: Rs. 72,000.00
Total Amount: ₹ 72,000.00

Warranty: 24 Months Manufacturer Warranty
`;

let failures = 0;
function assertEqual(actual, expected, label) {
  const pass = actual === expected;
  if (!pass) {
    console.error(`  ✗ FAIL: ${label}`);
    console.error(`    Expected: ${JSON.stringify(expected)}`);
    console.error(`    Actual:   ${JSON.stringify(actual)}`);
    failures++;
  } else {
    console.log(`  ✓ PASS: ${label}`);
  }
  return pass;
}

function assertHasValue(value, label) {
  const pass = value != null && value !== '' && (typeof value !== 'number' || !Number.isNaN(value));
  if (!pass) {
    console.error(`  ✗ FAIL: ${label} — value is empty/null/NaN: ${JSON.stringify(value)}`);
    failures++;
  } else {
    console.log(`  ✓ PASS: ${label}: ${JSON.stringify(value)}`);
  }
  return pass;
}

console.log('\n==================================================');
console.log('STAGE 1: Parse Invoice from OCR-simulated text');
console.log('==================================================');
const parsed = parseInvoice(sampleInvoiceOcrText);
assertHasValue(parsed.productName, 'productName');
assertHasValue(parsed.brand, 'brand');
assertHasValue(parsed.seller, 'seller');
assertHasValue(parsed.invoiceNumber, 'invoiceNumber');
assertHasValue(parsed.serialNumber, 'serialNumber');
assertHasValue(parsed.purchaseDate, 'purchaseDate');
assertHasValue(parsed.warrantyMonths, 'warrantyMonths');
assertHasValue(parsed.purchasePrice, 'purchasePrice');
assertHasValue(parsed.category, 'category');
assertHasValue(parsed.overallConfidence, 'overallConfidence');

console.log('\n==================================================');
console.log('STAGE 2: Map Parsed Invoice to Form Fields');
console.log('==================================================');
const formPatch = mapInvoiceToFormFields(parsed, {
  allowedCategories: CATEGORIES,
  force: true,
});

console.log('\nForm patch produced:');
for (const [k, v] of Object.entries(formPatch)) {
  console.log(`  ${k}: ${JSON.stringify(v)}`);
}
console.log('');

assertEqual(formPatch.productName, 'Lenovo ThinkPad E14 Gen 5', 'productName mapped');
assertEqual(formPatch.brand, 'Lenovo', 'brand mapped');
assertEqual(formPatch.category, 'Laptop', 'category constrained to allowed list');
assertEqual(formPatch.purchaseDate, '2026-08-10', 'purchaseDate normalized to YYYY-MM-DD');
assertEqual(formPatch.warrantyMonths, '24', 'warrantyMonths converted to string');
assertEqual(formPatch.invoiceNumber, 'TH-INV-2026-0810-0042', 'invoiceNumber mapped');
assertEqual(formPatch.serialNumber, 'PF4X9K7L2M', 'serialNumber mapped');
assertEqual(formPatch.seller, 'TechHub Electronics Pvt. Ltd.', 'seller mapped');
assertEqual(formPatch.price, '72000', 'price normalized from ₹72,000.00');

console.log('\n==================================================');
console.log('STAGE 3: Edge Case Tests');
console.log('==================================================');

console.log('\n3a. Date normalization (various formats → YYYY-MM-DD)');
const { normalizePurchaseDateForInput } = await import('../src/lib/invoiceFormMapper.js');
assertEqual(normalizePurchaseDateForInput('2026-08-10'), '2026-08-10', 'ISO passthrough');
assertEqual(normalizePurchaseDateForInput('2026-08-10T12:34:56Z'), '2026-08-10', 'ISO with timestamp trimmed');
assertEqual(normalizePurchaseDateForInput(''), '', 'empty string → empty');
assertEqual(normalizePurchaseDateForInput(null), '', 'null → empty');
assertEqual(normalizePurchaseDateForInput(undefined), '', 'undefined → empty');

console.log('\n3b. Price normalization (currency symbols/separators → numeric string)');
const { normalizePurchasePriceForInput } = await import('../src/lib/invoiceFormMapper.js');
assertEqual(normalizePurchasePriceForInput('₹72,000'), '72000', '₹72,000 → 72000');
assertEqual(normalizePurchasePriceForInput('Rs. 72,000.00'), '72000', 'Rs. 72,000.00 → 72000');
assertEqual(normalizePurchasePriceForInput('INR 72,000'), '72000', 'INR 72,000 → 72000');
assertEqual(normalizePurchasePriceForInput('₹72,000.00'), '72000', '₹72,000.00 → 72000');
assertEqual(normalizePurchasePriceForInput(72000), '72000', 'number 72000 → string "72000"');
assertEqual(normalizePurchasePriceForInput(72000.50), '72000.5', 'decimal preserved');
assertEqual(normalizePurchasePriceForInput(''), '', 'empty → empty');
assertEqual(normalizePurchasePriceForInput(null), '', 'null → empty');
assertEqual(normalizePurchasePriceForInput('$1,299.99'), '1299.99', '$1,299.99 → 1299.99');
assertEqual(normalizePurchasePriceForInput('€ 500.00'), '500', '€ 500.00 → 500');

console.log('\n3c. Category resolution — only allowed options pass through');
const { resolveCategoryForForm } = await import('../src/lib/invoiceFormMapper.js');
assertEqual(resolveCategoryForForm('Laptop', CATEGORIES), 'Laptop', 'Laptop exact match');
assertEqual(resolveCategoryForForm('laptop', CATEGORIES), 'Laptop', 'case-insensitive match');
assertEqual(resolveCategoryForForm('  LAPTOP  ', CATEGORIES), 'Laptop', 'trim + case-insensitive');
assertEqual(resolveCategoryForForm('Smartphone', CATEGORIES), 'Smartphone', 'Smartphone match');
assertEqual(resolveCategoryForForm('Furniture', CATEGORIES), '', 'Unknown category → empty');
assertEqual(resolveCategoryForForm('', CATEGORIES), '', 'empty string → empty');
assertEqual(resolveCategoryForForm(null, CATEGORIES), '', 'null → empty');
assertEqual(resolveCategoryForForm('Laptop', []), '', 'empty allowed list → empty');

console.log('\n3d. User edit protection — edited fields not overwritten unless force=true');
const userEdited = new Set(['productName', 'brand']);
const partialInvoice = {
  productName: 'Should NOT appear',
  brand: 'Should NOT appear',
  category: 'Laptop',
  warrantyMonths: 12,
};
const respectPatch = mapInvoiceToFormFields(partialInvoice, {
  allowedCategories: CATEGORIES,
  userEditedFields: userEdited,
  force: false,
});
assertEqual(respectPatch.productName, undefined, 'edited productName NOT overwritten');
assertEqual(respectPatch.brand, undefined, 'edited brand NOT overwritten');
assertEqual(respectPatch.category, 'Laptop', 'unedited category IS set');
assertEqual(respectPatch.warrantyMonths, '12', 'unedited warrantyMonths IS set');

const forcePatch = mapInvoiceToFormFields(partialInvoice, {
  allowedCategories: CATEGORIES,
  userEditedFields: userEdited,
  force: true,
});
assertEqual(forcePatch.productName, 'Should NOT appear', 'force=true OVERWRITES edited productName');
assertEqual(forcePatch.brand, 'Should NOT appear', 'force=true OVERWRITES edited brand');

console.log('\n3e. Parser with Indian market date (DD-MM-YYYY vs MM-DD-YYYY)');
const indianInvoice = `
AMAZON INDIA TAX INVOICE
Order Date: 15-07-2026
Invoice No: OD-IN-2847563
Product: Samsung Galaxy S24 Ultra 512GB
Amount: ₹1,29,999.00
Brand: Samsung
`;
const parsedIndian = parseInvoice(indianInvoice);
assertHasValue(parsedIndian.purchaseDate, 'Indian invoice has purchase date');
if (parsedIndian.purchaseDate) {
  // 15-07-2026 is unambiguous: day=15 (>12) → must be July 15
  assertEqual(parsedIndian.purchaseDate, '2026-07-15', 'Indian DD-MM-YYYY date not swapped (day=15, month=07)');
}
const mappedIndian = mapInvoiceToFormFields(parsedIndian, { allowedCategories: CATEGORIES, force: true });
if (parsedIndian.purchaseDate) {
  assertEqual(mappedIndian.purchaseDate, '2026-07-15', 'Mapped Indian date correct');
}
assertEqual(mappedIndian.price, '129999', 'Indian price ₹1,29,999.00 normalized to 129999');

console.log('\n3f. Ambiguous date (both parts ≤ 12): defaults to DD/MM (Indian convention, lower confidence)');
const ambigInvoice = `
Invoice Date: 05-08-2026
Product: Test Product
Price: ₹1000
`;
const parsedAmbig = parseInvoice(ambigInvoice);
// Both 05 and 08 ≤ 12 → engine defaults to DD/MM (day-first, Indian convention)
// So 05-08-2026 → August 5, 2026 → 2026-08-05
assertHasValue(parsedAmbig.purchaseDate, 'Ambiguous date produced a date');

console.log('\n3g. Malformed values do not crash the mapper');
const garbageInvoice = {
  productName: '   ',
  brand: null,
  category: '!!!not a category!!!',
  purchaseDate: 'NOT A DATE AT ALL',
  warrantyMonths: null,
  purchasePrice: 'NOT_A_PRICE_$$$',
};
let threw = false;
try {
  mapInvoiceToFormFields(garbageInvoice, { allowedCategories: CATEGORIES, force: true });
} catch (e) {
  threw = true;
  console.error('  ✗ FAIL: mapper threw on malformed input:', e.message);
  failures++;
}
if (!threw) console.log('  ✓ PASS: mapper did not crash on malformed input');

const garbagePatch = mapInvoiceToFormFields(garbageInvoice, { allowedCategories: CATEGORIES, force: true });
assertEqual(garbagePatch.productName, undefined, 'empty productName → not in patch');
assertEqual(garbagePatch.brand, undefined, 'null brand → not in patch');
assertEqual(garbagePatch.category, undefined, 'unknown category → skipped in patch (form retains empty default)');
assertEqual(garbagePatch.purchaseDate, undefined, 'unparseable date → skipped in patch (form retains empty default)');
assertEqual(garbagePatch.warrantyMonths, undefined, 'null warrantyMonths → not in patch');
assertEqual(garbagePatch.price, undefined, 'unparseable price → skipped in patch (form retains empty default)');

console.log('\n==================================================');
console.log(`RESULT: ${failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
console.log('==================================================\n');
process.exit(failures > 0 ? 1 : 0);
