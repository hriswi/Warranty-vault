// mapper-check.mjs — verify category synonyms + supplement against real browser OCR text
import { pathToFileURL } from 'node:url';

const ROOT = 'C:/Autonomous-Warranty-Intelligence-System';
const { resolveCategoryForForm, supplementMissingProductFields, mapInvoiceToFormFields } =
  await import(pathToFileURL(`${ROOT}/frontend/src/lib/invoiceFormMapper.js`).href);
const { CATEGORIES } = await import(pathToFileURL(`${ROOT}/frontend/src/lib/engine/classifier/productDatabase.js`).href);

const cats = Object.values(CATEGORIES);
const results = [];
const check = (name, cond, detail = '') => {
  results.push([cond ? 'PASS' : 'FAIL', name, detail]);
};

// category synonyms
check('exact "Laptop"', resolveCategoryForForm('Laptop', cats) === 'Laptop');
check('synonym "laptop computer"', resolveCategoryForForm('laptop computer', cats) === 'Laptop');
check('synonym "Notebook"', resolveCategoryForForm('Notebook', cats) === 'Laptop');
check('synonym "Headphones"', resolveCategoryForForm('Headphones', cats) === 'Audio Device');
check('synonym "Smart TV"', resolveCategoryForForm('Smart TV', cats) === 'Television');
check('exact "Air Conditioner"', resolveCategoryForForm('Air Conditioner', cats) === 'Air Conditioner');
check('synonym "Split AC"', resolveCategoryForForm('Split AC', cats) === 'Air Conditioner');
check('synonym "Washing Machine"', resolveCategoryForForm('Washing Machine', cats) === 'Washing Machine');
check('synonym "Earbuds"', resolveCategoryForForm('Earbuds', cats) === 'Audio Device');
check('synonym "Microwave"', resolveCategoryForForm('Microwave', cats) === 'Microwave / Oven');
check('unknown → Other Electronics', resolveCategoryForForm('Mystery Gadget', cats) === 'Other Electronics');
check('desktop → Other Electronics (no Desktop option)', resolveCategoryForForm('Desktop Computer', cats) === 'Other Electronics');
check('empty → empty', resolveCategoryForForm('', cats) === '');

// supplement with the REAL browser OCR text (per-line columns)
const ocrText = `TECHHUB ELECTRONICS

TAX INVOICE

Invoice No:

TH-INV-2026-0810-0042

Invoice Date:

10-08-2026

Seller:

TechHub Electronics Pvt. Ltd.

GSTIN:

29AABCT1234K1Z5

Bill To:

Prasanth V

Bengaluru, Karnataka, India

Product

Brand

Model

Qty

Unit Price

Total

Laptop Computer

Lenovo

ThinkPad E14 Gen 5

1

Rs. 72,000

Rs. 72,000

Serial Number:

PF4X9K7L2M

Purchase Date:

10-08-2026

Warranty:

24 months manufacturer warranty

Warranty Start:

10-08-2026

Warranty End:

10-08-2028

Subtotal:

Rs. 72,000

GST (18%):

Rs. 12,960

Grand Total:

Rs. 84,960

Thank you for your purchase.

SYNTHETIC TEST DOCUMENT — NOT A REAL INVOICE OR PROOF OF PURCHASE.`;

// the exact local-engine fallback output for this text (7 fields, 3 empty)
const partial = {
  productName: '', brand: '', category: '',
  purchaseDate: '2026-08-10', warrantyMonths: '24',
  invoiceNumber: 'TH-INV-2026-0810-0042', serialNumber: 'PF4X9K7L2M',
  seller: 'TechHub Electronics Pvt. Ltd.', purchasePrice: '84960', currency: 'INR',
};

const padded = supplementMissingProductFields(partial, ocrText, cats);
check('supplement fills brand', padded.brand === 'Lenovo', JSON.stringify({ b: padded.brand }));
check('supplement fills productName', padded.productName === 'Lenovo ThinkPad E14 Gen 5', JSON.stringify({ pn: padded.productName }));
check('supplement fills category', padded.category === 'Laptop', JSON.stringify({ c: padded.category }));

const patch = mapInvoiceToFormFields(partial, { allowedCategories: cats, rawText: ocrText });
check('mapper patch has productName', patch.productName === 'Lenovo ThinkPad E14 Gen 5', JSON.stringify(patch.productName));
check('mapper patch has brand', patch.brand === 'Lenovo', JSON.stringify(patch.brand));
check('mapper patch has category', patch.category === 'Laptop', JSON.stringify(patch.category));

// existing fields untouched when supplement unnecessary
const full = { ...partial, productName: 'Custom Name', brand: 'CustomBrand', category: 'Television' };
const unchanged = mapInvoiceToFormFields(full, { allowedCategories: cats, rawText: ocrText });
check('existing values never overwritten', unchanged.productName === 'Custom Name' && unchanged.brand === 'CustomBrand' && unchanged.category === 'Television');

for (const [status, name, detail] of results) console.log(`${status}  ${name}${detail ? '  →  ' + detail : ''}`);
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
