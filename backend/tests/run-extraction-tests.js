/**
 * run-extraction-tests.js
 *
 * Tests for POST /api/ai/extract-invoice — the local-Qwen invoice
 * field extraction endpoint: strict JSON, schema validation, retry,
 * timeout/offline errors, and the price/category rules.
 *
 * Runs against the REAL server app with an in-process mock Qwen
 * (OpenAI-compatible chat/completions). Real Qwen coverage lives in
 * tests/e2e-dummy-invoice.mjs.
 */

import http from 'node:http';
import { createServer } from 'node:http';

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    process.stdout.write(`  ✗ ${name}\n    → ${err.message}\n`);
  }
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

// ── Mock Qwen (in-process, OpenAI-compatible) ────────────────────────────────

const VALID_JSON = {
  productName: 'Lenovo ThinkPad E14 Gen 5',
  brand: 'Lenovo',
  category: 'Laptop',
  purchaseDate: '2026-08-10',
  warrantyMonths: 24,
  invoiceNumber: 'TH-INV-2026-0810-0042',
  serialNumber: 'PF4X9K7L2M',
  seller: 'TechHub Electronics Pvt. Ltd.',
  purchasePrice: 'Rs. 84,960',
  currency: 'INR',
};

let behavior = { replies: [] }; // each chatComplete call consumes the next reply
let received = [];              // captured request bodies

const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'qwen' }] }));
      return;
    }
    if (req.url === '/v1/chat/completions') {
      received.push(JSON.parse(body || '{}'));
      const reply = behavior.replies.length ? behavior.replies.shift() : 'null';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
});

await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
const MOCK_URL = `http://127.0.0.1:${mock.address().port}/v1`;

process.env.NODE_ENV = 'test';
process.env.QWEN_BASE_URL = MOCK_URL;
process.env.QWEN_MODEL = 'qwen';
process.env.ALLOWED_ORIGIN = 'http://localhost:5173';

const { createApp } = await import('../server.js');
const { extractInvoice, parseStrictJson, validateExtraction, resolveAliases, isMissingCoreFields, EXTRACTION_KEYS, EXTRACTION_SYSTEM_PROMPT } =
  await import('../services/invoiceExtractionService.js');

const app = createApp();

function listen() {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function request(port, body) {
  const res = await fetch(`http://127.0.0.1:${port}/api/ai/extract-invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: () => { try { return JSON.parse(text); } catch (_) { return null; } } };
}

async function closeServer(server) {
  await new Promise((r) => setTimeout(r, 100));
  server.close();
}

function reset() {
  behavior.replies = [];
  received = [];
}

const DUMMY_TEXT = `TECHHUB ELECTRONICS TAX INVOICE
Invoice No: TH-INV-2026-0810-0042
Invoice Date: 10-08-2026
Seller: TechHub Electronics Pvt. Ltd.
Product: Laptop Computer Brand: Lenovo Model: ThinkPad E14 Gen 5
Qty 1 Unit Price Rs. 72,000 Total Rs. 72,000
Serial Number: PF4X9K7L2M
Purchase Date: 10-08-2026
Warranty: 24 months manufacturer warranty
Subtotal: Rs. 72,000
GST (18%): Rs. 12,960
Grand Total: Rs. 84,960`;

// ── unit: parsing ────────────────────────────────────────────────────────────

section('parseStrictJson');

await test('parses plain JSON object', () => {
  const r = parseStrictJson('{"productName":"A","brand":"B"}');
  assertEqual(r.productName, 'A', 'productName');
});

await test('strips markdown code fences', () => {
  const r = parseStrictJson('```json\n{"productName":"A"}\n```');
  assertEqual(r.productName, 'A', 'productName');
});

await test('prose with an embedded object is still parsed', () => {
  const r = parseStrictJson('Here you go: {"productName":"A"} hope that helps!');
  assertEqual(r.productName, 'A', 'productName');
});

await test('garbage / no braces returns null', () => {
  assert(parseStrictJson('I am sorry, I cannot help with that.') === null, 'null expected');
  assert(parseStrictJson('') === null, 'empty returns null');
  assert(parseStrictJson(null) === null, 'non-string returns null');
});

await test('arrays are rejected', () => {
  assert(parseStrictJson('[1,2,3]') === null, 'array rejected');
});

// ── unit: schema validation ──────────────────────────────────────────────────

section('validateExtraction');

await test('accepts a complete valid object', () => {
  const r = validateExtraction({ ...VALID_JSON, purchasePrice: 84960 });
  assert(r.ok, 'ok');
  assertEqual(r.data.warrantyMonths, 24, 'months');
  assertEqual(r.data.purchasePrice, 84960, 'price');
  assertEqual(r.data.purchaseDate, '2026-08-10', 'date');
});

await test('nulls are legal for every field', () => {
  const r = validateExtraction({ productName: 'X' });
  assert(r.ok, 'ok');
  assertEqual(r.data.brand, null, 'brand null');
  assertEqual(r.data.currency, null, 'currency null');
});

await test('invalid purchaseDate fails schema', () => {
  const r = validateExtraction({ productName: 'X', purchaseDate: '10-08-2026' });
  assert(!r.ok, 'not ok');
  assert(r.problems.includes('purchaseDate:invalid'), 'problem listed');
});

await test('warrantyMonths must be an integer 1..240', () => {
  assert(!validateExtraction({ productName: 'X', warrantyMonths: 'twenty-four' }).ok, 'string rejected');
  assert(!validateExtraction({ productName: 'X', warrantyMonths: 0 }).ok, 'zero rejected');
  assert(!validateExtraction({ productName: 'X', warrantyMonths: 999 }).ok, 'huge rejected');
  assert(validateExtraction({ productName: 'X', warrantyMonths: 24 }).ok, '24 ok');
});

await test('all-null output fails schema (nothing extracted)', () => {
  const r = validateExtraction({});
  assert(!r.ok, 'not ok');
  assert(r.problems.includes('all-null'), 'all-null listed');
});

await test('price strings are normalized to numbers', () => {
  const r = validateExtraction({ productName: 'X', purchasePrice: 'Rs. 84,960' });
  assert(r.ok, 'ok');
  assertEqual(r.data.purchasePrice, 84960, 'normalized price');
});

// ── unit: alias normalization ────────────────────────────────────────────────

section('resolveAliases / isMissingCoreFields');

await test('alternative key names map to the canonical schema', () => {
  const r = resolveAliases({
    product_name: 'Lenovo ThinkPad E14 Gen 5',
    manufacturer: 'Lenovo',
    product_category: 'Laptop',
    invoice_no: 'TH-INV-2026-0810-0042',
    purchase_price: '84960',
  });
  assertEqual(r.productName, 'Lenovo ThinkPad E14 Gen 5', 'product_name → productName');
  assertEqual(r.brand, 'Lenovo', 'manufacturer → brand');
  assertEqual(r.category, 'Laptop', 'product_category → category');
  assertEqual(r.invoiceNumber, 'TH-INV-2026-0810-0042', 'invoice_no → invoiceNumber');
  assertEqual(r.purchasePrice, '84960', 'purchase_price → purchasePrice');
});

await test('canonical keys win when both canonical and alias are present', () => {
  const r = resolveAliases({ productName: 'Real Name', product: 'Alias Name' });
  assertEqual(r.productName, 'Real Name', 'canonical preferred');
});

await test('validateExtraction accepts aliased keys', () => {
  const r = validateExtraction({
    product_name: 'Lenovo ThinkPad E14 Gen 5',
    manufacturer: 'Lenovo',
    product_category: 'Laptop',
    purchaseDate: '2026-08-10',
    warrantyMonths: 24,
    invoice_number: 'TH-INV-2026-0810-0042',
    serialNumber: 'PF4X9K7L2M',
    seller: 'TechHub Electronics Pvt. Ltd.',
    purchasePrice: 'Rs. 84,960',
    currency: 'INR',
  });
  assert(r.ok, 'ok');
  assertEqual(r.data.productName, 'Lenovo ThinkPad E14 Gen 5', 'productName');
  assertEqual(r.data.brand, 'Lenovo', 'brand');
  assertEqual(r.data.category, 'Laptop', 'category');
  assertEqual(r.data.invoiceNumber, 'TH-INV-2026-0810-0042', 'invoiceNumber');
});

await test('isMissingCoreFields only fires when the invoice was otherwise parsed', () => {
  const complete = { productName: 'X', brand: 'Y', category: 'Z', purchaseDate: '2026-08-10', warrantyMonths: 24, invoiceNumber: 'I', serialNumber: 'S', seller: 'V', purchasePrice: 100, currency: 'INR' };
  const missingCore = { ...complete, productName: null, brand: null, category: null };
  assert(!isMissingCoreFields(complete), 'complete is fine');
  assert(isMissingCoreFields(missingCore), 'core-null with 7 others triggers retry');
  assert(!isMissingCoreFields({ productName: null, brand: null, category: null }), 'bare nulls do not trigger');
  assert(!isMissingCoreFields(null), 'null input safe');
});

// ── endpoint: happy path ─────────────────────────────────────────────────────

section('POST /api/ai/extract-invoice');

await test('valid JSON → 200 with normalized data on first attempt', async () => {
  reset();
  behavior.replies = [JSON.stringify(VALID_JSON)];
  const { server, port } = await listen();
  try {
    const r = await request(port, { text: DUMMY_TEXT });
    assertEqual(r.status, 200, 'status');
    const body = r.json();
    assertEqual(body.ok, true, 'ok flag');
    assertEqual(body.attempts, 1, 'single attempt');
    const d = body.data;
    assertEqual(d.productName, 'Lenovo ThinkPad E14 Gen 5', 'productName');
    assertEqual(d.brand, 'Lenovo', 'brand');
    assertEqual(d.category, 'Laptop', 'category');
    assertEqual(d.purchaseDate, '2026-08-10', 'purchaseDate');
    assertEqual(d.warrantyMonths, 24, 'warrantyMonths');
    assertEqual(d.invoiceNumber, 'TH-INV-2026-0810-0042', 'invoiceNumber');
    assertEqual(d.serialNumber, 'PF4X9K7L2M', 'serialNumber');
    assertEqual(d.seller, 'TechHub Electronics Pvt. Ltd.', 'seller');
    assertEqual(d.purchasePrice, 84960, 'grand total selected');
    assertEqual(d.currency, 'INR', 'currency');
    assertEqual(Object.keys(d).sort().join(','), [...EXTRACTION_KEYS].sort().join(','), 'exact key set');
  } finally {
    await closeServer(server);
  }
});

await test('prompt enforces price = final total and category inference', async () => {
  reset();
  behavior.replies = [JSON.stringify(VALID_JSON)];
  const { server, port } = await listen();
  try {
    await request(port, { text: DUMMY_TEXT });
    const body = received[0];
    const system = body.messages[0].content;
    assertEqual(body.temperature, 0, 'temperature 0 for determinism');
    assert(system.includes('grand total'), 'grand-total rule present');
    assert(system.includes('subtotal'), 'subtotal mentioned');
    assert(system.includes('infer'), 'category inference rule present');
    assert(system.includes('null'), 'null rule present');
    assert(system.includes('TH') === false, 'no invoice values hardcoded in prompt');
  } finally {
    await closeServer(server);
  }
});

await test('malformed JSON → retry → valid JSON on second attempt', async () => {
  reset();
  behavior.replies = ['This is not JSON at all. Sorry!', JSON.stringify(VALID_JSON)];
  const { server, port } = await listen();
  try {
    const r = await request(port, { text: DUMMY_TEXT });
    assertEqual(r.status, 200, 'status');
    const body = r.json();
    assertEqual(body.attempts, 2, 'two attempts');
    assertEqual(body.data.brand, 'Lenovo', 'data recovered');
    assertEqual(received.length, 2, 'two calls made');
    const retryMsg = received[1].messages[received[1].messages.length - 1].content;
    assert(retryMsg.includes('previous answer'), 'corrective instruction sent');
  } finally {
    await closeServer(server);
  }
});

await test('schema violation (bad date) → retry → corrected on second attempt', async () => {
  reset();
  behavior.replies = [
    JSON.stringify({ ...VALID_JSON, purchaseDate: '10-08-2026' }), // non-ISO date
    JSON.stringify(VALID_JSON),
  ];
  const { server, port } = await listen();
  try {
    const r = await request(port, { text: DUMMY_TEXT });
    assertEqual(r.status, 200, 'status');
    const body = r.json();
    assertEqual(body.attempts, 2, 'two attempts');
    assertEqual(body.data.purchaseDate, '2026-08-10', 'corrected date');
  } finally {
    await closeServer(server);
  }
});

await test('markdown-fenced JSON is accepted on first attempt', async () => {
  reset();
  behavior.replies = [`\`\`\`json\n${JSON.stringify(VALID_JSON)}\n\`\`\``];
  const { server, port } = await listen();
  try {
    const r = await request(port, { text: DUMMY_TEXT });
    assertEqual(r.status, 200, 'status');
    assertEqual(r.json().attempts, 1, 'single attempt');
  } finally {
    await closeServer(server);
  }
});

await test('invalid JSON twice → 422 EXTRACTION_INVALID_RESPONSE', async () => {
  reset();
  behavior.replies = ['nope', 'still nope'];
  const { server, port } = await listen();
  try {
    const r = await request(port, { text: DUMMY_TEXT });
    assertEqual(r.status, 422, 'status');
    assertEqual(r.json().error.code, 'EXTRACTION_INVALID_RESPONSE', 'error code');
  } finally {
    await closeServer(server);
  }
});

await test('all-null output twice → 422', async () => {
  reset();
  behavior.replies = ['{"productName":null,"brand":null}', '{"productName":null}'];
  const { server, port } = await listen();
  try {
    const r = await request(port, { text: DUMMY_TEXT });
    assertEqual(r.status, 422, 'status');
  } finally {
    await closeServer(server);
  }
});

await test('core fields null while invoice parsed → one retry recovers them', async () => {
  reset();
  const missingCore = JSON.stringify({
    productName: null, brand: null, category: null,
    purchaseDate: '2026-08-10', warrantyMonths: 24,
    invoiceNumber: 'TH-INV-2026-0810-0042', serialNumber: 'PF4X9K7L2M',
    seller: 'TechHub Electronics Pvt. Ltd.', purchasePrice: 'Rs. 84,960', currency: 'INR',
  });
  behavior.replies = [missingCore, JSON.stringify(VALID_JSON)];
  const { server, port } = await listen();
  try {
    const r = await request(port, { text: DUMMY_TEXT });
    assertEqual(r.status, 200, 'status');
    const body = r.json();
    assertEqual(body.attempts, 2, 'two attempts');
    assertEqual(body.data.productName, 'Lenovo ThinkPad E14 Gen 5', 'productName recovered');
    assertEqual(body.data.brand, 'Lenovo', 'brand recovered');
    assertEqual(body.data.category, 'Laptop', 'category recovered');
    assertEqual(received.length, 2, 'two calls made');
  } finally {
    await closeServer(server);
  }
});

await test('core fields still null on retry → 200 with honest nulls (no 422)', async () => {
  reset();
  const missingCore = {
    productName: null, brand: null, category: null,
    purchaseDate: '2026-08-10', warrantyMonths: 24,
    invoiceNumber: 'TH-INV-2026-0810-0042', serialNumber: 'PF4X9K7L2M',
    seller: 'TechHub Electronics Pvt. Ltd.', purchasePrice: 'Rs. 84,960', currency: 'INR',
  };
  behavior.replies = [JSON.stringify(missingCore), JSON.stringify(missingCore)];
  const { server, port } = await listen();
  try {
    const r = await request(port, { text: DUMMY_TEXT });
    assertEqual(r.status, 200, 'status');
    const body = r.json();
    assertEqual(body.attempts, 2, 'two attempts');
    assertEqual(body.data.productName, null, 'productName stays null');
    assertEqual(body.data.purchaseDate, '2026-08-10', 'parsed fields preserved');
  } finally {
    await closeServer(server);
  }
});

await test('aliased-key reply → 200 with canonical keys on first attempt', async () => {
  reset();
  behavior.replies = [JSON.stringify({
    product_name: 'Lenovo ThinkPad E14 Gen 5',
    manufacturer: 'Lenovo',
    product_category: 'Laptop',
    purchaseDate: '2026-08-10',
    warrantyMonths: 24,
    invoice_no: 'TH-INV-2026-0810-0042',
    serialNumber: 'PF4X9K7L2M',
    seller: 'TechHub Electronics Pvt. Ltd.',
    price: 'Rs. 84,960',
    currency: 'INR',
  })];
  const { server, port } = await listen();
  try {
    const r = await request(port, { text: DUMMY_TEXT });
    assertEqual(r.status, 200, 'status');
    const d = r.json().data;
    assertEqual(d.productName, 'Lenovo ThinkPad E14 Gen 5', 'productName');
    assertEqual(d.brand, 'Lenovo', 'brand');
    assertEqual(d.category, 'Laptop', 'category');
    assertEqual(d.invoiceNumber, 'TH-INV-2026-0810-0042', 'invoiceNumber');
    assertEqual(d.purchasePrice, 84960, 'price');
  } finally {
    await closeServer(server);
  }
});

await test('prompt forbids alternative key names and restricts categories to the real list', async () => {
  reset();
  behavior.replies = [JSON.stringify(VALID_JSON)];
  const { server, port } = await listen();
  try {
    await request(port, { text: DUMMY_TEXT });
    const system = received[0].messages[0].content;
    assert(system.includes('No alternative key names'), 'alt-key ban present');
    assert(system.includes('product_name_or_model'), 'specific banned alias listed');
    assert(system.includes('MUST be one of'), 'category restricted to real list');
    assert(system.includes('Microwave / Oven'), 'real category value listed');
    assert(system.includes('Power Tool') === false, 'phantom category not listed');
    assert(system.includes('Keyboard / Mouse'), 'real category value listed');
  } finally {
    await closeServer(server);
  }
});

await test('empty / missing text → 400', async () => {
  reset();
  const { server, port } = await listen();
  try {
    const r1 = await request(port, {});
    assertEqual(r1.status, 400, 'empty body');
    const r2 = await request(port, { text: '   ' });
    assertEqual(r2.status, 400, 'blank text');
  } finally {
    await closeServer(server);
  }
});

await test('oversized text → 400', async () => {
  reset();
  const { server, port } = await listen();
  try {
    const r = await request(port, { text: 'x'.repeat(200001) });
    assertEqual(r.status, 400, 'status');
  } finally {
    await closeServer(server);
  }
});

await test('Qwen offline → 503 QWEN_OFFLINE with friendly message', async () => {
  reset();
  const previous = process.env.QWEN_BASE_URL;
  process.env.QWEN_BASE_URL = 'http://127.0.0.1:59997/v1';
  const { server, port } = await listen();
  try {
    const r = await request(port, { text: DUMMY_TEXT });
    assertEqual(r.status, 503, 'status');
    const body = r.json();
    assertEqual(body.error.code, 'QWEN_OFFLINE', 'error code');
    assert(body.error.message.includes('offline'), 'friendly message');
  } finally {
    process.env.QWEN_BASE_URL = previous;
    await closeServer(server);
  }
});

await test('service rejects extraction from a disallowed origin', async () => {
  reset();
  behavior.replies = [JSON.stringify(VALID_JSON)];
  const { server, port } = await listen();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ai/extract-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
      body: JSON.stringify({ text: DUMMY_TEXT }),
    });
    assertEqual(res.status, 403, 'status');
  } finally {
    await closeServer(server);
  }
});

// ── unit: service-level (no HTTP) ────────────────────────────────────────────

section('extractInvoice service');

await test('extractInvoice honors a custom timeoutMs', async () => {
  reset();
  behavior.replies = [JSON.stringify(VALID_JSON)];
  const result = await extractInvoice(DUMMY_TEXT, { timeoutMs: 5000 });
  assertEqual(result.attempts, 1, 'attempts');
  assertEqual(result.data.purchasePrice, 84960, 'price');
  assertEqual(received[0].max_tokens, 700, 'max tokens');
});

mock.close();

console.log('\n' + '═'.repeat(65));
console.log(`  EXTRACTION TESTS: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n  FAILURES:');
  failures.forEach((f) => console.log(`    ✗ ${f.name}\n      ${f.error}`));
}
console.log('═'.repeat(65) + '\n');

process.exit(failed > 0 ? 1 : 0);
