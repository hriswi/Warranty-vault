/**
 * qwenService.js
 *
 * Client for the local llama.cpp OpenAI-compatible endpoint (Qwen).
 *
 * The model runs on the user's machine via C:\AI\start-qwen.bat
 * (llama-server bound to 127.0.0.1:8080). This service is the ONLY
 * place in the backend that talks to the local model — nothing else
 * should implement the Qwen protocol.
 *
 * Configuration (environment variables, all optional):
 *   QWEN_BASE_URL   default http://127.0.0.1:8080/v1
 *   QWEN_MODEL      default qwen
 *   QWEN_TIMEOUT_MS default 120000 (per request)
 */

import { EventEmitter } from 'node:events';

const DEFAULT_BASE_URL = 'http://127.0.0.1:8080/v1';
const DEFAULT_MODEL = 'qwen';

export function getQwenConfig() {
  return {
    baseUrl: (process.env.QWEN_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    model: process.env.QWEN_MODEL || DEFAULT_MODEL,
    timeoutMs: Number(process.env.QWEN_TIMEOUT_MS) || 120000,
    connectTimeoutMs: 10000,
  };
}

/**
 * Normalized Qwen error type. `code` values:
 *   QWEN_OFFLINE  — server unreachable (not started / wrong port)
 *   QWEN_TIMEOUT  — server did not answer in time
 *   QWEN_HTTP     — server answered with a non-2xx status
 *   QWEN_BAD_RESPONSE — unexpected response shape
 */
export class QwenError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'QwenError';
    this.code = code;
    Object.assign(this, extra);
  }
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 120000) {
  const config = getQwenConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let externalSignal = null;
  if (init.signal) {
    externalSignal = init.signal;
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    const aborted = externalSignal?.aborted || controller.signal.aborted;
    if (aborted) {
      const abortErr = new Error('Request aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
    if (err?.name === 'AbortError') {
      throw new QwenError('QWEN_TIMEOUT', `Qwen did not respond within ${Math.round(timeoutMs / 1000)}s.`);
    }
    const reason = err?.cause?.code || err?.code || err?.message || 'unknown';
    if (typeof reason === 'string' && ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT'].includes(reason)) {
      throw new QwenError(
        'QWEN_OFFLINE',
        'Local AI is currently offline. Start the Qwen server and try again.'
      );
    }
    throw new QwenError('QWEN_OFFLINE', `Cannot reach local AI server: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cheap reachability probe used by /api/health.
 * @returns {Promise<{reachable: boolean, model: string|null, latencyMs: number|null}>}
 */
export async function probeQwen() {
  const config = getQwenConfig();
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(`${config.baseUrl}/models`, { method: 'GET' }, 3000);
    if (!res.ok) return { reachable: false, model: null, latencyMs: null };
    const data = await res.json().catch(() => null);
    const model = Array.isArray(data?.data) ? data.data[0]?.id : null;
    return { reachable: true, model: model || config.model, latencyMs: Date.now() - started };
  } catch (err) {
    if (err?.code === 'QWEN_TIMEOUT') return { reachable: false, model: null, latencyMs: Date.now() - started };
    return { reachable: false, model: null, latencyMs: null };
  }
}

/**
 * Calls Qwen chat completions and returns the full (non-streamed) text.
 * Used for the short tool-decision turn and invoice field extraction.
 */
export async function chatComplete({ messages, temperature = 0.1, maxTokens = 64, signal, timeoutMs } = {}) {
  const config = getQwenConfig();
  const res = await fetchWithTimeout(
    `${config.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal,
    },
    timeoutMs || config.timeoutMs
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new QwenError('QWEN_HTTP', `Qwen returned HTTP ${res.status}.`, {
      status: res.status,
      detail: body.slice(0, 500),
    });
  }

  const data = await res.json().catch(() => null);
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new QwenError('QWEN_BAD_RESPONSE', 'Qwen returned an unexpected response shape.');
  }
  return text;
}

/**
 * Opens a streaming chat completion. The underlying fetch starts
 * IMMEDIATELY (eagerly), so callers can `await ready` before writing
 * anything to the client — a Qwen failure then surfaces as a clean
 * JSON error instead of a half-started SSE stream.
 *
 * @param {object} opts same as streamChatComplete
 * @returns {{ ready: Promise<void>, stream: AsyncGenerator<string> }}
 *   ready rejects with QwenError (offline/timeout/http) before any
 *   chunks are consumed; stream yields text deltas and can throw
 *   mid-iteration on unexpected failure.
 */
export function openChatStream({ messages, temperature = 0.2, maxTokens = 800, signal } = {}) {
  const config = getQwenConfig();

  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const fetchPromise = fetchWithTimeout(
    `${config.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      }),
      signal,
    },
    config.timeoutMs
  )
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new QwenError('QWEN_HTTP', `Qwen returned HTTP ${res.status}.`, {
          status: res.status,
          detail: body.slice(0, 500),
        });
      }
      if (!res.body) {
        throw new QwenError('QWEN_BAD_RESPONSE', 'Qwen did not return a streamable body.');
      }
      resolveReady();
      return res;
    })
    .catch((err) => {
      rejectReady(err);
      throw err;
    });

  // The generator below re-awaits fetchPromise, so a rejection here is
  // only "unhandled" until iteration starts. Mark it handled to avoid
  // crashing the process when the caller awaits `ready` and never
  // consumes the stream (e.g. the Qwen-offline 503 path).
  void fetchPromise.catch(() => {});

  const stream = (async function* () {
    const res = await fetchPromise;
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
          if (!line || !line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let json;
          try { json = JSON.parse(payload); } catch (_) { continue; }
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            yield delta;
          }
        }
      }
      if (buffer.trim()) {
        const line = buffer.trim();
        if (line.startsWith('data:')) {
          const payload = line.slice(5).trim();
          if (payload && payload !== '[DONE]') {
            try {
              const json = JSON.parse(payload);
              const delta = json?.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta.length > 0) yield delta;
            } catch (_) { /* trailing partial json is fine to drop */ }
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch (_) { /* ignore */ }
    }
  })();

  return { ready, stream };
}

/**
 * Creates an async iteration wrapper that also emits events, for
 * consumers that prefer a callback style.
 */
export function streamChatCompleteEmitter(options) {
  const emitter = new EventEmitter();
  const { ready, stream } = openChatStream(options);
  ready
    .then(async () => {
      try {
        for await (const delta of stream) {
          emitter.emit('delta', delta);
        }
        emitter.emit('end');
      } catch (err) {
        emitter.emit('error', err);
      }
    })
    .catch((err) => emitter.emit('error', err));
  return emitter;
}

export default {
  getQwenConfig,
  probeQwen,
  chatComplete,
  openChatStream,
  QwenError,
};
