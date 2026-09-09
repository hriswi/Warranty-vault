/**
 * AgentPage.jsx
 * Conversational AI assistant backed by the local Qwen model.
 *
 *   React → POST /api/ai/chat → Node backend → Qwen (127.0.0.1:8080)
 *
 * The backend owns the Qwen protocol and the deterministic product
 * context. This page only renders a clean chat: streaming answers,
 * typing indicator, stop/retry, and small metadata ("Based on your
 * warranty records") — no internal reasoning or pipeline stages.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare, Send, Brain, RotateCcw, Shield, TrendingUp, Clock, AlertTriangle, Zap, Square, RefreshCw, ExternalLink,
} from 'lucide-react';
import { useStore } from '../../store/store.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { streamChat, checkBackendHealth, ApiError } from '../../lib/api.js';

const SUGGESTED_PROMPTS = [
  { icon: Shield,       text: 'Is my laptop warranty still active?' },
  { icon: Clock,        text: 'Which of my products expire soon?' },
  { icon: TrendingUp,   text: 'Show me my highest risk device' },
  { icon: AlertTriangle,text: 'Are any invoices suspicious?' },
  { icon: Brain,        text: 'Look up the specs for my laptop' },
  { icon: Brain,        text: 'What happens if my keyboard stops working?' },
  { icon: Zap,          text: 'How long until my TV warranty expires?' },
];

const HISTORY_LIMIT = 10;
const OFFLINE_MESSAGE = 'Local AI is currently offline. Start the Qwen server and try again.';

/** Reduces store products to the compact fields the backend expects. */
function pruneProducts(products) {
  return (Array.isArray(products) ? products : []).map((p) => ({
    id: p.id,
    productName: p.productName,
    brand: p.brand,
    category: p.category,
    purchaseDate: p.purchaseDate,
    warrantyMonths: p.warrantyMonths,
    invoiceNumber: p.invoiceNumber,
    serialNumber: p.serialNumber,
    seller: p.seller,
    price: p.price,
    riskScore: p.riskScore,
    fraudScore: p.fraudScore,
    fraudSignals: Array.isArray(p.fraudSignals) ? p.fraudSignals.slice(0, 6) : [],
    repairHistory: Array.isArray(p.repairHistory) ? p.repairHistory.slice(0, 5) : [],
  }));
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-white/30"
          style={{ animation: `pulseSlow 1.4s ease-in-out ${i * 0.2}s infinite` }}
        />
      ))}
    </div>
  );
}

function AssistantMeta({ msg }) {
  if (msg.error) return null;
  if (msg.dataSource === 'web' || (msg.sources && msg.sources.length > 0)) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-white/25 font-mono tracking-[0.1em] uppercase">
          Live web results
        </span>
        {msg.sources?.slice(0, 3).map((s, i) => (
          <a
            key={i}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full text-white/40 hover:text-white/70"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <ExternalLink size={9} />
            {s.title || s.url.replace(/^https?:\/\//, '').split('/')[0]}
          </a>
        ))}
      </div>
    );
  }
  if (msg.dataSource === 'records' && msg.content) {
    return (
      <p className="mt-2 text-[10px] text-white/25 font-mono tracking-[0.08em]">
        Based on your warranty records
      </p>
    );
  }
  return null;
}

function Message({ msg, onRetry, onSuggestion }) {
  const isUser = msg.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[70%] px-4 py-3 rounded-[10px] text-sm"
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.85)',
            lineHeight: 1.65,
            whiteSpace: 'pre-wrap',
          }}
        >
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%]">
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <Brain size={10} className="text-white/50" />
          </div>
          <span className="text-white/25 text-[11px] font-mono tracking-[0.1em]">ASSISTANT</span>
        </div>

        <div
          className="px-4 py-3 rounded-[10px] text-sm"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: msg.error ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(255,255,255,0.07)',
            color: 'rgba(255,255,255,0.7)',
            lineHeight: 1.7,
          }}
        >
          <div style={{ whiteSpace: 'pre-wrap' }}>
            {msg.content || (msg.streaming ? '' : '…')}
            {msg.streaming && <TypingDots />}
          </div>

          <AssistantMeta msg={msg} />

          {msg.error && onRetry && (
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={() => onRetry(msg)}
                className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-full transition-all"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'rgba(255,255,255,0.6)',
                }}
              >
                <RefreshCw size={11} /> Try again
              </button>
              {msg.code === 'QWEN_OFFLINE' && (
                <span className="text-[10px] text-white/25 font-mono">
                  Start C:\AI\start-qwen.bat
                </span>
              )}
            </div>
          )}
        </div>

        {msg.followUpSuggestions?.length > 0 && !msg.error && (
          <div className="flex flex-wrap gap-2 mt-2">
            {msg.followUpSuggestions.slice(0, 3).map((s, i) => (
              <button
                key={i}
                onClick={() => onSuggestion?.(s)}
                className="text-[11px] px-3 py-1.5 rounded-full transition-all"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: 'rgba(255,255,255,0.4)',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgentPage() {
  const { products } = useStore();
  const { user } = useAuth();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [backendStatus, setBackendStatus] = useState('checking'); // checking | ready | ai-offline | backend-offline
  const [aiProvider, setAiProvider] = useState('local-qwen');

  const scrollRef = useRef(null);
  const nearBottomRef = useRef(true);
  const abortRef = useRef(null);
  const inputRef = useRef(null);

  const welcomeMessage = user
    ? products.length > 0
      ? `Yo — I can see ${products.length} product${products.length === 1 ? '' : 's'} with warranty, risk, and invoice-integrity details. I can also look up current specs, recalls, and device info when you ask.\n\nWhat are we checking?`
      : "Yo — I can help with warranty coverage, risk, suspicious invoices, expiry dates, troubleshooting, and live device details.\n\nAdd a product first, then hit me with a question."
    : "Sign in first, then we can check your warranty records and device details.";

  // Health probe — the status pill tells the user Qwen/backend state honestly.
  useEffect(() => {
    let cancelled = false;
    checkBackendHealth().then((h) => {
      if (cancelled) return;
      setBackendStatus(h.state || 'backend-offline');
      setAiProvider(h.provider || 'local-qwen');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setMessages([{ id: 'welcome', role: 'agent', content: welcomeMessage }]);
  }, [user?.uid]);

  // Auto-scroll only when the user is already near the bottom.
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    if (nearBottomRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, loading]);

  const sendQuery = useCallback(async (rawQuery) => {
    const query = String(rawQuery || '').trim();
    if (!query || loading) return;

    const userMsg = { id: `u-${Date.now()}`, role: 'user', content: query };
    const agentMsg = {
      id: `a-${Date.now()}`,
      role: 'agent',
      content: '',
      streaming: true,
      error: false,
      dataSource: null,
      sources: [],
    };

    setMessages((prev) => [...prev, userMsg, agentMsg]);
    setInput('');
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Bounded history: last N completed turns (user+assistant).
      const history = messages
        .filter((m) => m.role === 'user' || (m.role === 'agent' && !m.error && m.content))
        .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }))
        .slice(-HISTORY_LIMIT);

      const events = streamChat({
        messages: [...history, { role: 'user', content: query }],
        products: pruneProducts(products),
        signal: controller.signal,
      });

      let receivedDelta = false;
      for await (const event of events) {
        if (event.type === 'meta') {
          setMessages((prev) => prev.map((m) =>
            m.id === agentMsg.id
              ? { ...m, dataSource: event.dataSource || 'records', sources: event.webResults || [], webUnavailable: event.webUnavailable }
              : m
          ));
        } else if (event.type === 'delta' && typeof event.text === 'string') {
          receivedDelta = true;
          const text = event.text;
          setMessages((prev) => prev.map((m) =>
            m.id === agentMsg.id ? { ...m, content: m.content + text } : m
          ));
        } else if (event.type === 'error') {
          throw new ApiError(event.code || 'QWEN_ERROR', event.message || 'AI request failed.');
        }
      }

      setMessages((prev) => prev.map((m) =>
        m.id === agentMsg.id
          ? { ...m, streaming: false, content: m.content || (receivedDelta ? m.content : "I don't have enough information to answer that yet.") }
          : m
      ));
    } catch (err) {
      let content;
      let code = err?.code;
      if (err?.name === 'AbortError') {
        content = null; // stopped by user — keep whatever streamed so far
      } else if (err instanceof ApiError && (err.state === 'AI_OFFLINE' || err.code === 'QWEN_OFFLINE')) {
        content = OFFLINE_MESSAGE;
      } else if (err instanceof ApiError && err.code === 'BACKEND_UNREACHABLE') {
        content = 'Cannot reach the local AI bridge on http://localhost:3000 — start it with `cd backend && npm start`.';
      } else if (err instanceof ApiError) {
        content = err.message || 'The assistant could not answer. Try again.';
      } else {
        content = 'The assistant hit a problem. Try again in a moment.';
      }

      setMessages((prev) => prev.map((m) =>
        m.id === agentMsg.id
          ? {
              ...m,
              streaming: false,
              error: code !== 'AbortError',
              code: code === 'AbortError' ? null : code,
              content: m.content || content || '',
              stoppedByUser: code === 'AbortError',
            }
          : m
      ));
    } finally {
      setLoading(false);
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [loading, messages, products]);

  const handleRetry = (failedMsg) => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    setMessages((prev) => prev.filter((m) => m.id !== failedMsg.id));
    sendQuery(lastUser.content);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setLoading(false);
  };

  const handleReset = () => {
    abortRef.current?.abort();
    setMessages([{ id: 'welcome', role: 'agent', content: welcomeMessage }]);
    setInput('');
    checkBackendHealth().then((h) => {
      setBackendStatus(h.state || 'backend-offline');
      setAiProvider(h.provider || 'local-qwen');
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendQuery(input);
  };

  const isHostedAi = aiProvider === 'cloudflare-workers-ai';
  const statusLabel = backendStatus === 'ready'
    ? (isHostedAi ? 'Hosted AI ready' : 'Local AI ready')
    : backendStatus === 'ai-offline'
    ? (isHostedAi ? 'Hosted AI offline' : 'Local AI offline')
    : backendStatus === 'backend-offline'
    ? 'AI bridge offline'
    : 'Checking…';

  return (
    <div className="flex flex-col h-full" style={{ maxHeight: 'calc(100vh - 56px)' }}>
      <div
        className="flex items-center justify-between px-6 py-4 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: '#080808' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <Brain size={13} className="text-white/60" />
          </div>
          <div>
            <h1 className="font-equinox text-white text-sm tracking-[0.08em]">AI ASSISTANT</h1>
            <p className="text-white/25 text-[11px]">
              {products.length} product{products.length !== 1 ? 's' : ''} in context
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span
            className="inline-flex items-center gap-2 text-[11px] font-mono px-3 py-1.5 rounded-full"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: backendStatus === 'ready' ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.35)',
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: backendStatus === 'ready' ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)',
                boxShadow: backendStatus === 'ready' ? '0 0 0 3px rgba(255,255,255,0.08)' : 'none',
              }}
            />
            {statusLabel}
          </span>
          <button
            onClick={handleReset}
            className="flex items-center gap-2 text-white/25 text-xs hover:text-white/50 transition-colors"
            title="Reset conversation"
          >
            <RotateCcw size={13} /> Reset
          </button>
        </div>
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-6">
          {messages.length <= 1 && (
            <div>
              <p className="text-white/20 text-xs font-mono tracking-[0.15em] uppercase mb-3">Try asking</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SUGGESTED_PROMPTS.map(({ icon: Icon, text }, i) => (
                  <button
                    key={i}
                    onClick={() => sendQuery(text)}
                    disabled={loading}
                    className="flex items-center gap-3 px-4 py-3 rounded-[10px] text-left group transition-all"
                    style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.045)';
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.13)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.025)';
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)';
                    }}
                  >
                    <Icon size={14} className="text-white/30 shrink-0 group-hover:text-white/50 transition-colors" />
                    <span className="text-white/45 text-sm group-hover:text-white/65 transition-colors leading-snug">{text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <Message key={msg.id} msg={msg} onRetry={handleRetry} onSuggestion={sendQuery} />
          ))}

          <div className="h-1" />
        </div>
      </div>

      <div
        className="px-6 py-4 shrink-0"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)', background: '#050505' }}
      >
        <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSubmit} className="flex gap-3 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendQuery(input);
                }
              }}
              placeholder="Ask about your warranties…"
              disabled={loading}
              rows={1}
              className="input-field w-full resize-none"
              style={{ maxHeight: '120px', minHeight: '44px', paddingTop: '12px', paddingBottom: '12px' }}
            />
            {loading ? (
              <button
                type="button"
                onClick={handleStop}
                className="btn-primary px-4 py-2.5 shrink-0"
                style={{ minWidth: '44px', background: 'rgba(255,255,255,0.1)', color: '#fff' }}
                title="Stop generating"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="btn-primary px-4 py-2.5 shrink-0"
                style={{ minWidth: '44px' }}
                title="Send"
              >
                <Send size={15} />
              </button>
            )}
          </form>
          <p className="text-white/15 text-[11px] mt-2 text-center font-mono">
            {backendStatus === 'ai-offline'
              ? (isHostedAi
                ? 'Hosted AI is temporarily unavailable — try again in a moment.'
                : 'Qwen is not responding on 127.0.0.1:8080 — start it with C:\\AI\\start-qwen.bat to chat.')
              : backendStatus === 'backend-offline'
              ? (isHostedAi
                ? 'Cannot reach the hosted AI service — check your connection and try again.'
                : 'AI bridge unreachable — start it with `cd backend && npm start`.')
              : (isHostedAi
                ? 'Hosted AI · Sign-in required · Live web lookup for specs & recalls'
                : 'Local AI via Qwen · All data stays on your device')}
          </p>
        </div>
      </div>
    </div>
  );
}
