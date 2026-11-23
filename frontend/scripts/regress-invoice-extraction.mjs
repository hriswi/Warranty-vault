import assert from 'node:assert/strict';
import fs from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseInvoice } from '../src/lib/engine/parsers/invoiceParser.js';
import { supplementMissingProductFields } from '../src/lib/invoiceFormMapper.js';
import { readAmazonInvoice } from '../src/lib/amazonInvoice.js';
import { CATEGORIES } from '../src/lib/engine/classifier/productDatabase.js';

const CATEGORY_LIST = Object.values(CATEGORIES);

// ── Amazon Noise Buds Play: real invoice1.pdf page 1 ──────────────────
async function amazonCase() {
  const data = new Uint8Array(fs.readFileSync(process.argv[2] || 'invoice1.pdf'));
  const task = getDocument({ data, useSystemFonts: true });
  const doc = await task.promise;
  let page1 = '';
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = content.items.map(i => i.str + (i.hasEOL ? '\n' : ' ')).join('');
    if (/Noise|Buds Play|PAX1-773785/.test(text)) page1 = text;
  }
  await task.destroy();
  assert(page1, 'Amazon product page (page 1) located in invoice1.pdf');

  const pipelineInv = parseInvoice(page1);
  const local = supplementMissingProductFields(pipelineInv, page1, CATEGORY_LIST);

  console.log('AMAZON page-1 extraction:', JSON.stringify(local, null, 2));

  assert(local.productName && /Buds Play|Noise/i.test(local.productName), 'product name: ' + local.productName);
  assertEqual(local.brand, 'Noise', 'brand');
  assertEqual(local.category, 'Audio Device', 'category');
  assertEqual(local.invoiceNumber, 'PAX1-773785', 'invoice number');
  assertEqual(local.orderNumber, '408-5569467-6337940', 'order number');
  assertEqual(local.purchasePrice, 1199, 'price ₹1,199');
  assertEqual(local.serialNumber, null, 'ASIN is separate from serial');
  assert(local.warrantyMonths == null, 'warranty not specified (null)');
  console.log('  ✓ Amazon Noise Buds Play regression passed');
}

// ── Flipkart Samsung Galaxy A14 5G: synthetic product page ────────────
function flipkartCase() {
  const page = `
Flipkart.com
TAX INVOICE
Invoice Number: FAJC2L2500186660
Invoice Date: 03.09.2026
Order Number: OD1234567890123
Seller: Flipkart.com
IMEI: 3548 8966 6146 616
Item: Samsung Galaxy A14 5G
Brand: Samsung
Qty: 1
Unit Price: Rs. 10,749.00
Total: Rs. 10,749.00
Warranty: 12 Months Manufacturer Warranty for Device and 6 Months Manufacturer Warranty for In-Box Accessories.
`;
  const r = parseInvoice(page);
  console.log('FLIPKART product page parse:', JSON.stringify(r, null, 2));
  assert(r.productName && /Galaxy\s*A14/i.test(r.productName), 'product name: ' + r.productName);
  assertEqual(r.invoiceNumber, 'FAJC2L2500186660', 'invoice number');
  assertEqual(r.serialNumber, '354889666146616', 'serial with spaces stripped');
  assertEqual(r.purchasePrice, 10749, 'price ₹10,749');
  assertEqual(r.warrantyMonths, 12, 'device warranty 12 months');
  assertEqual(r.accessoryWarrantyMonths, 6, 'accessories warranty 6 months');
  assertEqual(r.brand, 'Samsung', 'brand');
  console.log('  ✓ Flipkart Samsung Galaxy A14 5G regression passed');
}

function assertEqual(actual, expected, message) {
  assert.strictEqual(actual, expected, `${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

(async () => {
  flipkartCase();
  await amazonCase();
  console.log('\nAll invoice-extraction regression checks passed.');
})().catch((err) => { console.error('REGRESSION FAILED:', err.message); process.exit(1); });

