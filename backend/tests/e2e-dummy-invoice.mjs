/**
 * e2e-dummy-invoice.mjs
 *
 * REAL end-to-end demonstration of the AI extraction pipeline using the
 * repo's synthetic invoice: dummy_warranty_invoice_test (1).pdf
 *
 *   PDF → text extraction (pdf.js text layer — the browser path renders
 *         the PDF and runs Tesseract OCR on it; both feed the SAME
 *         backend endpoint with raw text)
 *   → POST /api/ai/extract-invoice on the REAL backend
 *   → local Qwen (llama-server at 127.0.0.1:8080, must be running)
 *   → strict structured JSON + schema validation + retry-once
 *   → the REAL frontend mapper (frontend/src/lib/invoiceFormMapper.js)
 *     → the exact form patch UploadPage would apply
 *
 * No invoice values are hardcoded into the extraction request — the
 * PDF is read from disk. Expected values below are ASSERTIONS against
 * the invoice's known content, not inputs.
 *
 * Usage: npm run test:e2e   (from backend/) — requires Qwen running.
 */

import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = 'C:/Autonomous-Warranty-Intelligence-System';
const PDF_PATH = `${ROOT}/dummy_warranty_invoice_test (1).pdf`;
const BACKEND_PORT = 3210;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// ── Stage 1: text extraction from the PDF (pdf.js, frontend's copy) ─────────

const { getDocument } = await import(pathToFileURL(`${ROOT}/frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs`).href);
const pdfBytes = await readFile(PDF_PATH);
const doc = await getDocument({ data: new Uint8Array(pdfBytes), isEvalSupported: false, useSystemFonts: true }).promise;

let rawText = '';
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const tc = await page.getTextContent();
  for (const item of tc.items) {
    if ('str' in item) rawText += item.str + '\n';
  }
}
rawText = rawText.trim();
console.log(`\n── Stage 1: text extraction (${doc.numPages} page, ${rawText.length} chars) ──`);
console.log(rawText.slice(0, 400) + (rawText.length > 400 ? ' …' : ''));
check('extracted text is non-empty', rawText.length > 100, `${rawText.length} chars`);

// ── Stage 2: start the real backend ─────────────────────────────────────────

console.log('\n── Stage 2: starting backend on 127.0.0.1:' + BACKEND_PORT + ' ──');
const backend = spawn('node', ['server.js'], {
  cwd: `${ROOT}/backend`,
  env: { ...process.env, PORT: String(BACKEND_PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
backend.stdout.on('data', (d) => process.stdout.write(`[backend] ${d}`));
backend.stderr.on('data', (d) => process.stderr.write(`[backend-err] ${d}`));

async function waitForHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/health`, { headers: { Connection: 'close' } });
      if (res.ok) {
        const body = await res.json();
        if (body.qwen?.reachable) return body;
      }
    } catch (_) { /* not up yet */ }
    await sleep(300);
  }
  return null;
}

try {
  const health = await waitForHealth();
  check('backend + Qwen reachable', Boolean(health?.qwen?.reachable), JSON.stringify(health?.qwen));

  // ── Stage 3: extraction via local Qwen ────────────────────────────────────

  console.log('\n── Stage 3: POST /api/ai/extract-invoice (local Qwen) ──');
  // Origin + preflight simulate the real browser (Vite dev server on 5174).
  const preflight = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/ai/extract-invoice`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5174',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  check('CORS preflight from browser origin passes', preflight.status === 204, `status=${preflight.status}`);
  check('preflight CORS header echoes origin', preflight.headers.get('access-control-allow-origin') === 'http://localhost:5174', String(preflight.headers.get('access-control-allow-origin')));

  const started = Date.now();
  const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/ai/extract-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Connection: 'close', Origin: 'http://localhost:5174' },
    body: JSON.stringify({ text: rawText }),
  });
  const body = await res.json();
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`HTTP ${res.status} after ${elapsed}s, attempts=${body?.attempts}`);
  check('HTTP 200 (browser origin accepted)', res.status === 200, `status=${res.status}`);
  check('schema keys are exact', body?.ok === true);

  console.log('\n── Stage 4: structured JSON returned by Qwen ──');
  console.log(JSON.stringify(body?.data ?? body?.error, null, 2));

  if (body?.ok && body?.data) {
    const d = body.data;

    // ── Stage 5: map through the REAL UploadPage form mapper ────────────────

    const { mapInvoiceToFormFields, resolveCategoryForForm, supplementMissingProductFields } = await import(
      pathToFileURL(`${ROOT}/frontend/src/lib/invoiceFormMapper.js`).href
    );
    const { CATEGORIES } = await import(
      pathToFileURL(`${ROOT}/frontend/src/lib/engine/classifier/productDatabase.js`).href
    );
    const formPatch = mapInvoiceToFormFields(d, {
      allowedCategories: Object.values(CATEGORIES),
      userEditedFields: new Set(),
      force: true,
      rawText,
    });

    console.log('\n── Stage 5: UploadPage form values (exactly what the form displays) ──');
    for (const key of ['productName', 'brand', 'category', 'purchaseDate', 'warrantyMonths', 'invoiceNumber', 'serialNumber', 'seller', 'price']) {
      console.log(`  ${key.padEnd(15)} → ${JSON.stringify(formPatch[key] ?? '')}`);
    }

    // ── Stage 6: assertions against the known invoice content ───────────────

    console.log('\n── Stage 6: assertions ──');
    check('brand = Lenovo', d.brand === 'Lenovo', JSON.stringify(d.brand));
    check('category inferred = Laptop', d.category === 'Laptop', JSON.stringify(d.category));
    check('productName contains ThinkPad E14', typeof d.productName === 'string' && /thinkpad\s*e14/i.test(d.productName), JSON.stringify(d.productName));
    check('purchaseDate = 2026-08-10 (ISO)', d.purchaseDate === '2026-08-10', JSON.stringify(d.purchaseDate));
    check('warrantyMonths = 24', d.warrantyMonths === 24, JSON.stringify(d.warrantyMonths));
    check('invoiceNumber matches', typeof d.invoiceNumber === 'string' && /TH-INV-2026-0810-0042/.test(d.invoiceNumber), JSON.stringify(d.invoiceNumber));
    check('serialNumber = PF4X9K7L2M', d.serialNumber === 'PF4X9K7L2M', JSON.stringify(d.serialNumber));
    check('seller contains TechHub', typeof d.seller === 'string' && /techhub/i.test(d.seller), JSON.stringify(d.seller));
    check('purchasePrice = 84,960 (GRAND total, not 72,000 subtotal)', d.purchasePrice === 84960, JSON.stringify(d.purchasePrice));
    check('currency = INR', d.currency === 'INR', JSON.stringify(d.currency));
    check('form price field = "84960"', formPatch.price === '84960', JSON.stringify(formPatch.price));

    // ── Stage 7: deterministic mapper behaviors (offline-fallback path) ─────

    const cats = Object.values(CATEGORIES);
    console.log('\n── Stage 7: deterministic category + supplement behaviors ──');
    check('category synonym "laptop computer" → Laptop', resolveCategoryForForm('laptop computer', cats) === 'Laptop', resolveCategoryForForm('laptop computer', cats));
    check('category synonym "Headphones" → Audio Device', resolveCategoryForForm('Headphones', cats) === 'Audio Device', resolveCategoryForForm('Headphones', cats));
    check('category synonym "Smart TV" → Television', resolveCategoryForForm('Smart TV', cats) === 'Television', resolveCategoryForForm('Smart TV', cats));
    check('category exact "Air Conditioner" passes through', resolveCategoryForForm('Air Conditioner', cats) === 'Air Conditioner', resolveCategoryForForm('Air Conditioner', cats));
    check('unknown category → Other Electronics', resolveCategoryForForm('Mystery Gadget', cats) === 'Other Electronics', resolveCategoryForForm('Mystery Gadget', cats));

    // The local (fallback) engine leaves productName/brand/category empty for
    // this invoice — the supplement must deterministically fill them from the
    // browser-equivalent OCR text.
    const fallbackInvoice = {
      productName: '', brand: '', category: '',
      purchaseDate: d.purchaseDate, warrantyMonths: d.warrantyMonths,
      invoiceNumber: d.invoiceNumber, serialNumber: d.serialNumber,
      seller: d.seller, purchasePrice: d.purchasePrice, currency: d.currency,
    };
    const supplemented = supplementMissingProductFields(fallbackInvoice, rawText, cats);
    check('supplement fills brand = Lenovo', supplemented.brand === 'Lenovo', JSON.stringify(supplemented.brand));
    check('supplement fills productName = Lenovo ThinkPad E14 Gen 5', supplemented.productName === 'Lenovo ThinkPad E14 Gen 5', JSON.stringify(supplemented.productName));
    check('supplement fills category = Laptop', supplemented.category === 'Laptop', JSON.stringify(supplemented.category));

    const fallbackPatch = mapInvoiceToFormFields(fallbackInvoice, {
      allowedCategories: cats,
      userEditedFields: new Set(),
      force: true,
      rawText,
    });
    check('fallback form patch productName filled', fallbackPatch.productName === 'Lenovo ThinkPad E14 Gen 5', JSON.stringify(fallbackPatch.productName));
    check('fallback form patch brand filled', fallbackPatch.brand === 'Lenovo', JSON.stringify(fallbackPatch.brand));
    check('fallback form patch category filled', fallbackPatch.category === 'Laptop', JSON.stringify(fallbackPatch.category));
  }
} finally {
  await sleep(400); // let the child wind down its sockets before terminating
  backend.kill();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
