/**
 * webSearchService.js
 *
 * Free, API-key-free web search for the AI assistant.
 *
 * Qwen is local and has no internet access — this service performs the
 * actual lookup on the backend. It prefers official/safe sources (the
 * search engine's ranking) and always returns the source URLs so the
 * UI can show them and the prompt can cite them.
 *
 * No paid APIs. Two tiers:
 *  1. DuckDuckGo Instant Answer API (structured, sparse)
 *  2. DuckDuckGo HTML endpoint (real results list, parsed with regex)
 *
 * Every failure path returns null — callers must tell the user that
 * live web lookup is unavailable rather than faking content.
 */

const INSTANT_ANSWER_URL = 'https://api.duckduckgo.com/';
const HTML_SEARCH_URL = 'https://html.duckduckgo.com/html/';
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RESULTS = 5;

export function sanitizeUrl(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    let href = u.href;
    if (href.endsWith('/')) href = href.slice(0, -1);
    return href;
  } catch (_) {
    return null;
  }
}

function decodeEntities(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

async function fetchWithTimeout(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en',
      },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    return res;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Tier 1: DuckDuckGo Instant Answer API (structured abstract). */
async function searchInstantAnswer(query) {
  const url = `${INSTANT_ANSWER_URL}?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&no_redirect=1`;
  const res = await fetchWithTimeout(url);
  if (!res) return null;

  const data = await res.json().catch(() => null);
  if (!data) return null;

  const results = [];
  const abstract = decodeEntities(data.AbstractText || '');
  const abstractSource = decodeEntities(data.AbstractSource || '');
  const abstractUrl = sanitizeUrl(data.AbstractURL || '');
  if (abstract && abstractUrl) {
    results.push({ title: abstractSource || abstractUrl, url: abstractUrl, snippet: abstract });
  }
  const answer = decodeEntities(data.Answer || '');
  if (answer && typeof data.AnswerType === 'string' && data.AnswerType.length > 0 && abstractUrl) {
    results[0] = { ...(results[0] || { title: 'Instant answer', url: abstractUrl }), snippet: `${answer} — ${abstract}`.trim() };
  }
  for (const topic of Array.isArray(data.RelatedTopics) ? data.RelatedTopics : []) {
    const t = topic?.Text ? topic : topic?.Topics?.[0];
    if (!t?.Text) continue;
    const url = sanitizeUrl(t.FirstURL || t.URL || '');
    if (!url) continue;
    results.push({ title: decodeEntities(t.Text.split(' - ')[0]), url, snippet: decodeEntities(t.Text) });
    if (results.length >= MAX_RESULTS) break;
  }
  return results.length > 0 ? results : null;
}

/** Tier 2: DuckDuckGo HTML results page parsed with regex. */
async function searchHtmlResults(query) {
  const res = await fetchWithTimeout(`${HTML_SEARCH_URL}?q=${encodeURIComponent(query)}&kl=us-en`);
  if (!res) return null;
  const html = await res.text().catch(() => '');
  if (!html || html.length < 200) return null;

  const results = [];
  const resultBlocks = html.split(/<div class="result"/i);
  for (const block of resultBlocks.slice(1)) {
    const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/is);
    const snippetMatch = block.match(/class="result__snippet"[^>]*>(.*?)<\/a>/is);
    if (!titleMatch) continue;

    let url = decodeEntities(titleMatch[1]);
    if (url.startsWith('//duckduckgo.com/l/?uddg=')) {
      try {
        url = decodeURIComponent(url.split('uddg=')[1].split('&')[0]);
      } catch (_) { /* keep raw */ }
    }
    url = sanitizeUrl(url);
    if (!url) continue;

    const title = decodeEntities(titleMatch[2].replace(/<[^>]+>/g, ''));
    const snippet = snippetMatch ? decodeEntities(snippetMatch[1].replace(/<[^>]+>/g, '')) : '';
    results.push({ title: title || url, url, snippet });
    if (results.length >= MAX_RESULTS) break;
  }
  return results.length > 0 ? results : null;
}

/**
 * Performs a web search and returns normalized results.
 * @param {string} query
 * @returns {Promise<{query:string, results:Array<{title,url,snippet}>, engine:string} | null>}
 *   null means the lookup failed entirely (network/timeout/no results).
 */
export async function webSearch(query) {
  const q = String(query || '').trim();
  if (!q || q.length < 3 || q.length > 300) return null;

  const instant = await searchInstantAnswer(q);
  if (instant) return { query: q, results: instant, engine: 'duckduckgo-instant' };

  const html = await searchHtmlResults(q);
  if (html) return { query: q, results: html, engine: 'duckduckgo' };

  return null;
}

export default { webSearch, sanitizeUrl };
