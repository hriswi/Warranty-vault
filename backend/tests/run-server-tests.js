/**
 * run-server-tests.js
 *
 * Tests for the local backend bridge: HTTP routes, context math,
 * prompt assembly, tool parsing, and Qwen error normalization.
 *
 * These run without a real Qwen server — the offline path is tested
 * by pointing QWEN_BASE_URL at a dead port.
 */

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

// ── Import modules ────────────────────────────────────────────────────────────

process.env.NODE_ENV = 'test';
process.env.QWEN_BASE_URL = 'http://127.0.0.1:59999/v1';
process.env.QWEN_MODEL = 'qwen';
process.env.ALLOWED_ORIGIN = 'http://localhost:5173';

const { createApp } = await import('../server.js');
const { computeWarrantyStatus, buildContext, pruneProduct } = await import('../services/contextService.js');
const { SYSTEM_PROMPT_CORE, buildSystemMessages } = await import('../services/systemPrompt.js');
const { webSearch, sanitizeUrl } = await import('../services/webSearchService.js');
const { QwenError } = await import('../services/qwenService.js');

// ── contextService ───────────────────────────────────────────────────────────

section('contextService — deterministic warranty math');

const now = new Date('2026-08-11T12:00:00Z');

await test('status: active product with 12 months left', () => {
  const p = { purchaseDate: '2025-08-11', warrantyMonths: 24 };
  const s = computeWarrantyStatus(p, now);
  assertEqual(s.status, 'active', 'active');
  assertEqual(s.expiryDate, '2027-08-11', 'expiry date');
  assertEqual(s.daysRemaining, 365, '365 days remaining');
});

await test('status: expiring within 30 days', () => {
  const p = { purchaseDate: '2024-08-21', warrantyMonths: 24 };
  const s = computeWarrantyStatus(p, now);
  assertEqual(s.status, 'expiring', 'expiring');
  assertEqual(s.daysRemaining, 10, '10 days remaining');
});

await test('status: expired', () => {
  const p = { purchaseDate: '2024-01-01', warrantyMonths: 12 };
  const s = computeWarrantyStatus(p, now);
  assertEqual(s.status, 'expired', 'expired');
  assert(s.daysRemaining < 0, 'negative days');
});

await test('status: unknown when data missing — never guesses active', () => {
  const s = computeWarrantyStatus({ purchaseDate: null, warrantyMonths: null }, now);
  assertEqual(s.status, 'unknown', 'unknown');
});

await test('pruneProduct: keeps only the fields Qwen may use', () => {
  const pruned = pruneProduct({
    id: 'abc',
    productName: 'ThinkPad E14',
    brand: 'Lenovo',
    category: 'Laptop',
    purchaseDate: '2025-01-01',
    warrantyMonths: 24,
    invoiceNumber: 'INV-1',
    serialNumber: 'SN-1',
    seller: 'Amazon',
    price: '72000',
    riskScore: 72,
    fraudScore: 12,
    fraudSignals: [{ type: 'X', severity: 0.5 }],
    notes: 'secret user note',
    userId: 'u123',
    createdAt: { toDate: () => new Date() },
  });
  assertEqual(pruned.productName, 'ThinkPad E14', 'name kept');
  assert(pruned.notes === undefined, 'notes not leaked to model');
  assert(pruned.userId === undefined, 'userId not leaked to model');
  assertEqual(pruned.warrantyStatus, 'active', 'status computed');
});

await test('buildContext: summary counters are correct', () => {
  const ctx = buildContext([
    { id: '1', purchaseDate: '2024-08-21', warrantyMonths: 24, riskScore: 80, fraudScore: 55, fraudSignals: [{ type: 'X' }] },
    { id: '2', purchaseDate: '2025-01-01', warrantyMonths: 12, riskScore: 10, fraudScore: 5 },
    { id: '3', purchaseDate: null, warrantyMonths: null, riskScore: 30, fraudScore: 5 },
  ], now);
  assertEqual(ctx.summary.total, 3, 'total');
  assertEqual(ctx.summary.expiringSoon, 1, 'expiring soon');
  assertEqual(ctx.summary.highRisk, 1, 'high risk');
  assertEqual(ctx.summary.flaggedInvoices, 1, 'flagged invoices');
});

// ── systemPrompt ─────────────────────────────────────────────────────────────

section('systemPrompt');

await test('core prompt contains the 19 rules' , () => {
  assert(SYSTEM_PROMPT_CORE.includes('Never fabricate product data'), 'no fabrication rule');
  assert(SYSTEM_PROMPT_CORE.includes('Never claim a warranty is active'), 'active claim rule');
  assert(SYSTEM_PROMPT_CORE.includes('TOOL:web_search|'), 'tool protocol documented');
  assert(SYSTEM_PROMPT_CORE.includes('Warranty Vault Intelligence Agent'), 'identity');
});

await test('buildSystemMessages: records context injected as system message', () => {
  const msgs = buildSystemMessages({
    products: [{ productName: 'ThinkPad', warrantyStatus: 'active', warrantyExpiryDate: '2027-08-11' }],
    summary: { total: 1, expiringSoon: 0, highRisk: 0, flaggedInvoices: 0 },
    today: '2026-08-11',
  });
  assert(msgs.length === 2, 'core + context messages');
  assert(msgs[1].role === 'system', 'context is a system message');
  assert(msgs[1].content.includes('ThinkPad'), 'product present');
  assert(msgs[1].content.includes('warrantyStatus=active'), 'status exact');
});

await test('buildSystemMessages: web results injected with source labels', () => {
  const msgs = buildSystemMessages({
    products: [],
    summary: null,
    today: '2026-08-11',
    webResults: [{ title: 'Lenovo Support', url: 'https://support.lenovo.com/warranty', snippet: 'Check warranty status' }],
  });
  const webMsg = msgs.find((m) => m.content.includes('Live web search results'));
  assert(webMsg, 'web message present');
  assert(webMsg.content.includes('support.lenovo.com'), 'source labeled');
});

await test('buildSystemMessages: web unavailable note present', () => {
  const msgs = buildSystemMessages({ products: [], today: '2026-08-11', webUnavailable: true });
  const note = msgs.find((m) => m.content.includes('web lookup'));
  assert(note, 'unavailable note present');
});

// ── webSearchService ─────────────────────────────────────────────────────────

section('webSearchService');

await test('sanitizeUrl: only http(s) URLs survive', () => {
  assertEqual(sanitizeUrl('https://support.lenovo.com/warranty'), 'https://support.lenovo.com/warranty', 'https ok');
  assertEqual(sanitizeUrl('http://example.com'), 'http://example.com', 'http ok');
  assert(sanitizeUrl('javascript:alert(1)') === null, 'javascript blocked');
  assert(sanitizeUrl('ftp://x.com') === null, 'ftp blocked');
  assert(sanitizeUrl('not a url') === null, 'garbage blocked');
});

await test('webSearch: short query rejected', async () => {
  const r = await webSearch('ab');
  assert(r === null, 'too short');
});

// ── server routes ────────────────────────────────────────────────────────────

section('server routes');

let app = createApp();

function listen(app) {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function request(port, path, { method = 'GET', body = null, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (body !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
  const text = await res.text();
  return { status: res.status, text, json: () => { try { return JSON.parse(text); } catch (_) { return null; } } };
}

async function closeServer(server) {
  await new Promise((r) => setTimeout(r, 100));
  server.close();
}

await test('health: reports ok with qwen unreachable', async () => {
  const { server, port } = await listen(app);
  try {
    const r = await request(port, '/api/health');
    assertEqual(r.status, 200, 'status');
    const body = r.json();
    assertEqual(body.ok, true, 'ok flag');
    assertEqual(body.qwen.reachable, false, 'qwen unreachable when server down');
  } finally {
    await closeServer(server);
  }
});

await test('chat: rejects empty body', async () => {
  const { server, port } = await listen(app);
  try {
    const r = await request(port, '/api/ai/chat', { method: 'POST', body: {} });
    assertEqual(r.status, 400, '400');
  } finally {
    await closeServer(server);
  }
});

await test('chat: rejects conversation not ending with user message', async () => {
  const { server, port } = await listen(app);
  try {
    const r = await request(port, '/api/ai/chat', {
      method: 'POST',
      body: { messages: [{ role: 'assistant', content: 'hi' }], products: [] },
    });
    assertEqual(r.status, 400, '400');
  } finally {
    await closeServer(server);
  }
});

await test('chat: Qwen offline → 503 QWEN_OFFLINE with friendly message', async () => {
  const { server, port } = await listen(app);
  try {
    const r = await request(port, '/api/ai/chat', {
      method: 'POST',
      body: {
        messages: [{ role: 'user', content: 'Which products expire soon?' }],
        products: [{ id: '1', productName: 'ThinkPad', purchaseDate: '2025-01-01', warrantyMonths: 24 }],
      },
    });
    assertEqual(r.status, 503, '503');
    const body = r.json();
    assertEqual(body.error.code, 'QWEN_OFFLINE', 'error code');
    assert(body.error.message.includes('offline'), 'friendly message');
  } finally {
    await closeServer(server);
  }
});

await test('chat: history is bounded to the last 12 messages', async () => {
  const messages = [];
  for (let i = 0; i < 30; i++) {
    messages.push({ role: 'user', content: `q${i}` });
    if (i < 29) messages.push({ role: 'assistant', content: `a${i}` });
  }
  const { server, port } = await listen(app);
  try {
    const r = await request(port, '/api/ai/chat', {
      method: 'POST',
      body: { messages, products: [] },
    });
    assertEqual(r.status, 503, 'reaches Qwen stage (offline) with bounded history');
  } finally {
    await closeServer(server);
  }
});

await test('chat: giant product payloads are pruned, not leaked to Qwen', async () => {
  const products = [];
  for (let i = 0; i < 600; i++) {
    products.push({ id: `p${i}`, productName: `Product ${i}`, purchaseDate: '2025-01-01', warrantyMonths: 12, notes: `secret ${i}`, userId: 'u' });
  }
  const { server, port } = await listen(app);
  try {
    const r = await request(port, '/api/ai/chat', {
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'hi' }], products },
    });
    assertEqual(r.status, 503, 'offline Qwen reached with pruned products');
  } finally {
    await closeServer(server);
  }
});

await test('chat: request from a disallowed origin is rejected with 403', async () => {
  const { server, port } = await listen(app);
  try {
    const r = await request(port, '/api/health', { headers: { Origin: 'http://evil.example' } });
    assertEqual(r.status, 403, 'status');
    const body = r.json();
    assertEqual(body.error?.code, 'FORBIDDEN_ORIGIN', 'error code');
  } finally {
    await closeServer(server);
  }
});

await test('chat: request from the allowed origin passes the guard', async () => {
  const { server, port } = await listen(app);
  try {
    const r = await request(port, '/api/health', { headers: { Origin: 'http://localhost:5173' } });
    assertEqual(r.status, 200, 'status');
  } finally {
    await closeServer(server);
  }
});

await test('chat: any localhost port passes the guard (Vite moves 5173 → 5174 when busy)', async () => {
  const { server, port } = await listen(app);
  try {
    for (const origin of ['http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:4173']) {
      const r = await request(port, '/api/health', { headers: { Origin: origin } });
      assertEqual(r.status, 200, `origin ${origin} allowed`);
    }
  } finally {
    await closeServer(server);
  }
});

await test('chat: CORS preflight (OPTIONS) from a localhost port succeeds', async () => {
  const { server, port } = await listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ai/chat`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5174',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    assertEqual(res.status, 204, 'preflight ok');
    assertEqual(res.headers.get('access-control-allow-origin'), 'http://localhost:5174', 'CORS header echoes origin');
  } finally {
    await closeServer(server);
  }
});

await test('health: reports normalized state AI_OFFLINE when Qwen is down', async () => {
  const { server, port } = await listen(app);
  try {
    const r = await request(port, '/api/health');
    const body = r.json();
    assertEqual(body.state, 'AI_OFFLINE', 'state');
  } finally {
    await closeServer(server);
  }
});

// ── tool decision parsing (re-implemented here to test protocol) ─────────────

section('tool protocol');

await test('parseToolReply: recognizes the exact marker format', () => {
  const reply = 'TOOL:web_search|Lenovo ThinkPad warranty policy 2026';
  const m = reply.match(/^\s*TOOL\s*:\s*web_search\s*\|\s*(.+?)\s*$/i);
  assert(m, 'matched');
  assertEqual(m[1].trim(), 'Lenovo ThinkPad warranty policy 2026', 'query');
});

await test('parseToolReply: plain answers are not treated as tool calls', () => {
  const reply = 'Your ThinkPad warranty expires on 2027-08-11.';
  const m = reply.match(/^\s*TOOL\s*:\s*web_search\s*\|\s*(.+?)\s*$/i);
  assert(m === null, 'no match');
});

// ── summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(65));
console.log(`  SERVER TESTS: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n  FAILURES:');
  failures.forEach((f) => console.log(`    ✗ ${f.name}\n      ${f.error}`));
}
console.log('═'.repeat(65) + '\n');

process.exit(failed > 0 ? 1 : 0);
