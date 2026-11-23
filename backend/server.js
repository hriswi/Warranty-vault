/**
 * server.js — Warranty Vault local backend bridge (port 3000).
 *
 * Responsibilities:
 *   - Accept chat requests from the frontend (POST /api/ai/chat)
 *   - Build deterministic context from the user's product records
 *   - Decide (with a short Qwen turn) when live web search is needed
 *   - Perform the web search, hand results to Qwen
 *   - Stream Qwen's final answer back to the browser over SSE
 *   - Report Qwen reachability (GET /api/health)
 *
 * The frontend stays on the user's machine (Vite), Qwen stays on
 * 127.0.0.1:8080 (llama-server, never exposed publicly). This server
 * owns the Qwen protocol — the browser never talks to Qwen directly.
 *
 * Env vars:
 *   PORT             default 3000
 *   ALLOWED_ORIGIN   default http://localhost:5173
 *   QWEN_BASE_URL    default http://127.0.0.1:8080/v1
 *   QWEN_MODEL       default qwen
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pathToFileURL } from 'node:url';
import {
  probeQwen,
  chatComplete,
  openChatStream,
  QwenError,
} from './services/qwenService.js';
import { buildContext } from './services/contextService.js';
import { buildSystemMessages } from './services/systemPrompt.js';
import { webSearch } from './services/webSearchService.js';
import { extractInvoice, ExtractionError } from './services/invoiceExtractionService.js';

const PORT = Number(process.env.PORT) || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:5173';
const MAX_HISTORY_MESSAGES = 12;
const MAX_PRODUCTS = 500;

/**
 * Origin policy. The frontend is a local Vite dev server whose port is
 * DYNAMIC (5173 is taken → Vite silently moves to 5174, 5175, …).
 * Any http(s) origin whose host is localhost/127.0.0.1 is accepted
 * regardless of port — a remote page cannot spoof its Origin, so this
 * stays safe for a local-only bridge. ALLOWED_ORIGIN (env) may add
 * explicit origins (e.g. a deployed frontend) on top.
 */
function isAllowedOrigin(origin) {
  if (!origin) return true; // non-browser clients (node, curl) — no CORS context
  const explicit = ALLOWED_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
  if (explicit.includes(origin)) return true;
  try {
    const u = new URL(origin);
    const host = u.hostname;
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return isLocalHost && (u.protocol === 'http:' || u.protocol === 'https:');
  } catch (_) {
    return false;
  }
}

const app = express();
// Strict origin guard: reject non-browser clients too (cors alone only
// withholds the CORS header; it does not stop the request).
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    res.status(403).json({ error: { code: 'FORBIDDEN_ORIGIN', message: 'Origin not allowed.' } });
    return;
  }
  next();
});
app.use(cors({ origin: (origin, cb) => cb(null, isAllowedOrigin(origin)) }));
app.use(express.json({ limit: '2mb' }));

/** Normalized AI state sent to the frontend (see README / api.js). */
function aiStateFor(code) {
  switch (code) {
    case 'QWEN_OFFLINE': return 'AI_OFFLINE';
    case 'QWEN_TIMEOUT':
    case 'QWEN_HTTP':
    case 'QWEN_BAD_RESPONSE':
    case 'BACKEND_UNREACHABLE': return 'AI_REQUEST_FAILED';
    case 'EXTRACTION_INVALID_RESPONSE': return 'AI_INVALID_RESPONSE';
    default: return null;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Regex gate: only queries that plausibly need CURRENT external info. */
function mayNeedWebInfo(query) {
  const q = ` ${String(query || '').toLowerCase()} `;
  const patterns = [
    /\b(current|latest|recent|newest|today|now|upcoming|announced|news)\b/,
    /\brecall(s|ed)?\b/,
    /\bservice center|service-centre|authorized (repair|service)\b/,
    /\bwarranty (policy|terms|coverage|conditions|extension|extended)\b/,
    /\bcurrent (price|specs?|models?|offer)\b/,
    /\brelease date|launch date\b/,
    /\b20(2[5-9]|[3-9][0-9])\b/,
  ];
  return patterns.some((re) => re.test(q));
}

/** Parses the short decision-turn reply into { tool: 'web_search', query } or null. */
function parseToolReply(reply) {
  if (typeof reply !== 'string') return null;
  const match = reply.match(/^\s*TOOL\s*:\s*web_search\s*\|\s*(.+?)\s*$/i);
  if (!match) return null;
  const query = match[1].trim();
  return query && query.length >= 3 && query.length <= 300
    ? { tool: 'web_search', query }
    : { tool: 'web_search', query: null };
}

function normalizeMessages(messages) {
  const cleaned = (Array.isArray(messages) ? messages : [])
    .map((m) => ({
      role: m?.role === 'assistant' ? 'assistant' : m?.role === 'system' ? 'system' : 'user',
      content: typeof m?.content === 'string' ? m.content.slice(0, 4000) : '',
    }))
    .filter((m) => m.content.trim().length > 0);
  if (cleaned.length === 0) return null;
  if (cleaned[cleaned.length - 1].role !== 'user') return null;
  return cleaned.slice(-MAX_HISTORY_MESSAGES);
}

function normalizeProducts(products) {
  const list = (Array.isArray(products) ? products : []).slice(0, MAX_PRODUCTS);
  return list;
}

function sendSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

// ── Routes ──────────────────────────────────────────────────────────────────

app.get('/api/health', async (_req, res) => {
  const qwen = await probeQwen();
  res.json({
    ok: true,
    service: 'warranty-vault-backend',
    state: qwen.reachable ? 'AI_READY' : 'AI_OFFLINE',
    qwen,
  });
});

/**
 * POST /api/ai/extract-invoice
 * Body: { text: string } — raw OCR/PDF text of an invoice.
 * Returns strict structured JSON via local Qwen (see
 * invoiceExtractionService). Qwen offline → 503 QWEN_OFFLINE,
 * timeout → 504 QWEN_TIMEOUT, invalid output after retry → 422.
 */
app.post('/api/ai/extract-invoice', async (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invoice text is required.' } });
    return;
  }
  if (text.length > 200000) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invoice text is too large (max 200000 chars).' } });
    return;
  }

  try {
    const result = await extractInvoice(text);
    res.json({ ok: true, data: result.data, attempts: result.attempts, state: 'AI_READY' });
  } catch (err) {
    if (err instanceof QwenError) {
      const status = err.code === 'QWEN_OFFLINE' ? 503 : err.code === 'QWEN_TIMEOUT' ? 504 : 502;
      res.status(status).json({ error: { code: err.code, state: aiStateFor(err.code), message: err.message } });
      return;
    }
    if (err instanceof ExtractionError) {
      res.status(422).json({ error: { code: err.code, state: aiStateFor(err.code), message: err.message } });
      return;
    }
    console.error('[extract-invoice] unexpected:', err);
    res.status(500).json({ error: { code: 'INTERNAL', state: 'AI_REQUEST_FAILED', message: 'Unexpected server error.' } });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/ai/product-research
// Body: { productName: string, brand?: string }
// Internet research for recalls / advisories / known reliability issues.
// Lightweight: pure web search + keyword classification (no LLM), so the
// product page can run it lazily AFTER rendering the deterministic score.
// ────────────────────────────────────────────────────────────────────────────
app.post('/api/ai/product-research', async (req, res) => {
  const productName = typeof req.body?.productName === 'string' ? req.body.productName.trim() : '';
  const brand = typeof req.body?.brand === 'string' ? req.body.brand.trim() : '';
  if (!productName) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'productName is required.' } });
    return;
  }
  try {
    const { researchProduct } = await import('../cloudflare-worker/src/productResearch.js');
    res.json(await researchProduct(productName, async q => (await webSearch(q))?.results));
  } catch (err) {
    console.error('[product-research] failed:', err.message);
    res.status(502).json({ error: { code: 'RESEARCH_FAILED', message: err.message } });
  }
});

function classifyProductResearchItem(text) {
  const t = String(text).toLowerCase();
  if (/(recall|voluntary.{0,20}removal|stop.{0,10}sale|safety.{0,10}(alert|hazard))/i.test(t)) return 'recall';
  if (/(service bulletin|service notice|advisory|advisories)/i.test(t)) return 'advisory';
  if (/(defect|faulty|flaw|lawsuit|class action|reliability|known issue|problems?|battery fire|overheat)/i.test(t)) return 'reliability';
  return 'other';
}

app.post('/api/ai/chat', async (req, res) => {
  const messages = normalizeMessages(req.body?.messages);
  if (!messages) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'A non-empty conversation ending with a user message is required.' } });
    return;
  }

  const products = normalizeProducts(req.body?.products);
  const context = buildContext(products);
  const query = messages[messages.length - 1].content;

  // Client disconnect → stop the Qwen generation.
  // (res 'close' fires when the client disconnects mid-stream; the guard
  //  skips the normal end-of-response close we trigger ourselves.)
  const clientSignal = new AbortController();
  res.on('close', () => {
    if (res.writableEnded) return;
    // Defer: aborting inside the close callback races undici's teardown.
    setImmediate(() => {
      try { clientSignal.abort(); } catch (_) { /* ignore */ }
    });
  });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  let streamStarted = false;

  try {
    let dataSource = 'records';
    let webResults = null;
    let webUnavailable = false;

    // ── Phase 1: short Qwen turn to decide if live web info is needed ──
    if (mayNeedWebInfo(query)) {
      const decisionMessages = buildSystemMessages({
        products: context.products,
        summary: context.summary,
        today: new Date().toISOString().split('T')[0],
      });
      decisionMessages.push({ role: 'user', content: query });

      const decision = await chatComplete({
        messages: decisionMessages,
        temperature: 0.1,
        maxTokens: 40,
        signal: clientSignal.signal,
      });

      const tool = parseToolReply(decision);
      if (tool?.query) {
        dataSource = 'web';
        try {
          const result = await webSearch(tool.query);
          webResults = result?.results?.slice(0, 5) || null;
          webUnavailable = !webResults;
        } catch (_) {
          webUnavailable = true;
        }
      }
    }

    // ── Phase 2: stream the final answer ──
    const finalMessages = buildSystemMessages({
      products: context.products,
      summary: context.summary,
      today: new Date().toISOString().split('T')[0],
      webResults,
      webUnavailable,
    });
    for (const m of messages) finalMessages.push(m);

    const chatStream = openChatStream({
      messages: finalMessages,
      temperature: 0.2,
      maxTokens: 800,
      signal: clientSignal.signal,
    });
    await chatStream.ready; // Qwen errors surface here, before any SSE bytes

    res.flushHeaders();
    streamStarted = true;

    sendSse(res, {
      type: 'meta',
      dataSource,
      webResults: webResults?.map((r) => ({ title: r.title, url: r.url })) || [],
      webUnavailable,
      productCount: context.products.length,
    });

    for await (const delta of chatStream.stream) {
      sendSse(res, { type: 'delta', text: delta });
    }

    sendSse(res, { type: 'done' });
    res.end();
  } catch (err) {
    if (err?.name === 'AbortError') {
      // Client cancelled (stop button) — close quietly.
      try { res.end(); } catch (_) { /* socket already closed */ }
      return;
    }
    if (!streamStarted) {
      const status = err instanceof QwenError
        ? (err.code === 'QWEN_OFFLINE' ? 503 : err.code === 'QWEN_TIMEOUT' ? 504 : 502)
        : 500;
      const code = err instanceof QwenError ? err.code : 'INTERNAL';
      const message = err instanceof QwenError ? err.message : 'Unexpected server error.';
      res.status(status).json({ error: { code, state: aiStateFor(code), message } });
      return;
    }
    try {
      sendSse(res, {
        type: 'error',
        code: err instanceof QwenError ? err.code : 'INTERNAL',
        state: aiStateFor(err instanceof QwenError ? err.code : 'INTERNAL'),
        message: err instanceof QwenError ? err.message : 'Unexpected server error.',
      });
    } catch (_) { /* socket already closed */ }
    try { res.end(); } catch (_) { /* socket already closed */ }
  }
});

export function createApp() {
  return app;
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain && process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[warranty-vault] backend listening on http://127.0.0.1:${PORT}`);
    console.log(`[warranty-vault] Qwen endpoint: ${process.env.QWEN_BASE_URL || 'http://127.0.0.1:8080/v1'} (model ${process.env.QWEN_MODEL || 'qwen'})`);
  });
}
