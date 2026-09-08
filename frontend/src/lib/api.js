/**
 * api.js — Frontend client for either the local Qwen bridge or hosted AI.
 *
 * The browser NEVER talks to Qwen directly. Everything goes through
 * the Node backend on the user's machine (port 3000 by default):
 *
 *   React app → POST /api/ai/chat → backend → Qwen (127.0.0.1:8080)
 *
 * Base URL is configurable via VITE_API_BASE_URL (see frontend/.env).
 * Keep http://localhost:3000 for local Qwen; point it to the Cloudflare
 * Worker URL to use hosted AI on lower-spec devices.
 */

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Lightweight health probe — reports whether the backend bridge AND
 * Qwen are reachable, with an honest normalized state:
 *   ready            — backend up, Qwen reachable (AI_READY)
 *   ai-offline       — backend up, Qwen unreachable (AI_OFFLINE)
 *   backend-offline  — cannot reach the backend on port 3000
 */
export async function checkBackendHealth(signal) {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return { state: 'backend-offline', ok: false, backendReachable: false, qwen: { reachable: false } };
    const body = await res.json().catch(() => ({}));
    const qwen = body.qwen || { reachable: false };
    const hostedReady = body.state === 'AI_READY' && body.provider === 'cloudflare-workers-ai';
    return {
      state: (qwen.reachable || hostedReady) ? 'ready' : 'ai-offline',
      ok: true,
      backendReachable: true,
      qwen,
      provider: body.provider || 'local-qwen',
    };
  } catch (_) {
    return { state: 'backend-offline', ok: false, backendReachable: false, qwen: { reachable: false } };
  }
}

/**
 * Streams a chat completion from the backend over SSE.
 *
 * Yields parsed SSE events: { type: 'meta'|'delta'|'error'|'done', ... }.
 * Throws ApiError on non-SSE JSON errors (e.g. Qwen offline → 503).
 *
 * @param {object} opts
 * @param {Array<{role:string,content:string}>} opts.messages - bounded history (last ~10)
 * @param {Array<object>} opts.products - the user's pruned product records
 * @param {AbortSignal} [opts.signal] - for the stop button
 * @returns {AsyncGenerator<object>}
 */
export async function* streamChat({ messages, products, signal }) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({
        messages: Array.isArray(messages) ? messages : [],
        products: Array.isArray(products) ? products : [],
      }),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(
      'BACKEND_UNREACHABLE',
      'Cannot reach the local AI bridge on http://localhost:3000 — start it with `cd backend && npm start`.'
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const code = body?.error?.code || 'BACKEND_ERROR';
    const message = body?.error?.message || `Backend error (HTTP ${res.status}).`;
    throw new ApiError(code, message, { status: res.status, state: body?.error?.state });
  }

  if (!res.body) throw new ApiError('BACKEND_ERROR', 'Backend returned no stream.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let event;
        try { event = JSON.parse(payload); } catch (_) { continue; }
        if (event && typeof event === 'object' && event.type) {
          yield event;
        }
      }
    }
    if (buffer.trim()) {
      const line = buffer.trim();
      if (line.startsWith('data:')) {
        const payload = line.slice(5).trim();
        if (payload) {
          try {
            const event = JSON.parse(payload);
            if (event && typeof event === 'object' && event.type) yield event;
          } catch (_) { /* trailing partial frame */ }
        }
      }
    }
  } finally {
    try { reader.releaseLock(); } catch (_) { /* ignore */ }
  }
}

/**
 * Calls the backend's invoice field extraction endpoint.
 * Raw OCR/PDF text in → strict structured JSON out (via local Qwen).
 *
 * @param {string} text - raw invoice text (OCR output)
 * @param {AbortSignal} [signal]
 * @returns {Promise<object>} normalized extraction JSON
 * @throws {ApiError} QWEN_OFFLINE (503) / QWEN_TIMEOUT (504) /
 *   EXTRACTION_INVALID_RESPONSE (422) / BACKEND_UNREACHABLE
 */
export async function extractInvoiceWithQwen(text, { signal } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/ai/extract-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: String(text ?? '').slice(0, 200000) }),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(
      'BACKEND_UNREACHABLE',
      'Local AI bridge is unreachable. Is the backend running? (cd backend && npm start)'
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const code = body?.error?.code || 'BACKEND_ERROR';
    const message = body?.error?.message || `Backend error (HTTP ${res.status}).`;
    throw new ApiError(code, message, { status: res.status, state: body?.error?.state });
  }

  const body = await res.json().catch(() => null);
  if (!body?.ok || !body?.data) {
    throw new ApiError('BACKEND_ERROR', 'Backend returned an unexpected response.');
  }
  return body.data;
}

/**
 * Calls the backend's product research endpoint (recalls / advisories /
 * known reliability issues for a product). Lightweight search — no LLM.
 *
 * @param {{productName: string, brand?: string}} product
 * @param {AbortSignal} [signal]
 * @returns {Promise<{evidence: Array<{title: string, url: string, snippet: string, category: string}>, researchedAt: string}>}
 * @throws {ApiError} BACKEND_UNREACHABLE / BACKEND_ERROR
 */
export async function productResearch({ productName, brand }, { signal } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/ai/product-research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productName: String(productName ?? ''), brand: String(brand ?? '') }),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(
      'BACKEND_UNREACHABLE',
      'Local AI bridge is unreachable. Is the backend running? (cd backend && npm start)'
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const code = body?.error?.code || 'BACKEND_ERROR';
    const message = body?.error?.message || `Backend error (HTTP ${res.status}).`;
    throw new ApiError(code, message, { status: res.status, state: body?.error?.state });
  }

  const body = await res.json().catch(() => null);
  if (!body?.ok) {
    throw new ApiError('BACKEND_ERROR', 'Backend returned an unexpected response.');
  }
  return body;
}

export default { API_BASE, ApiError, checkBackendHealth, streamChat, extractInvoiceWithQwen, productResearch };
