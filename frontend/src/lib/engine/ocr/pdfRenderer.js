/**
 * pdfRenderer.js
 *
 * pdf.js-backed PDF page rasterizer for the OCR pipeline.
 * Runs entirely in the browser — no Node APIs, no backend.
 *
 * pdf.js v6: PDFDocumentProxy has cleanup() but no destroy().
 * Teardown belongs on PDFDocumentLoadingTask.destroy().
 */

let pdfjsLibPromise = null;

async function loadPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = (async () => {
      const mod = await import('pdfjs-dist');
      const pdfjs = mod.default ?? mod;
      const GlobalWorkerOptions = pdfjs.GlobalWorkerOptions ?? mod.GlobalWorkerOptions;
      if (GlobalWorkerOptions && !GlobalWorkerOptions.workerSrc) {
        try {
          const workerUrl = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
          const src = typeof workerUrl === 'string' ? workerUrl : workerUrl?.default;
          if (typeof src === 'string' && src) GlobalWorkerOptions.workerSrc = src;
        } catch (_) {
          // Node/tests: leave unset so pdf.js falls back to its fake worker.
        }
      }
      return pdfjs;
    })();
  }
  return pdfjsLibPromise;
}

function getDocumentFn(pdfjs) {
  const fn = pdfjs.getDocument ?? pdfjs.default?.getDocument;
  if (typeof fn !== 'function') throw new Error('pdf.js getDocument is unavailable.');
  return fn;
}

/**
 * pdf.js v6 owns destruction on the loading task, not the document proxy.
 * Calling destroy() on the proxy throws TypeError: destroy is not a function
 * (minified in the browser as "i.destroy is not a function").
 */
export function resolvePdfDestroyTarget(loadingTask, doc) {
  if (loadingTask && typeof loadingTask.destroy === 'function') return loadingTask;
  if (doc?.loadingTask && typeof doc.loadingTask.destroy === 'function') return doc.loadingTask;
  return null;
}

export async function closePdfDocument(loadingTask, doc) {
  try {
    if (typeof doc?.cleanup === 'function') await doc.cleanup();
  } catch (_) { /* keep teardown going */ }
  const target = resolvePdfDestroyTarget(loadingTask, doc);
  if (!target) return;
  try { await target.destroy(); } catch (_) { /* never fail the caller after a successful read */ }
}

async function openPdf(source) {
  const pdfjs = await loadPdfjs();
  const data = await readSourceToArrayBuffer(source);
  const loadingTask = getDocumentFn(pdfjs)({ data, useSystemFonts: true });
  const doc = await loadingTask.promise;
  return { loadingTask, doc };
}

export async function readPdfTextPages(source, limit) {
  const { loadingTask, doc } = await openPdf(source);
  try {
    const pages = [];
    for (let n = 1; n <= Math.min(limit, doc.numPages); n++) {
      const page = await doc.getPage(n);
      try {
        const content = await page.getTextContent();
        const text = content.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('');
        pages.push(text);
      } catch { pages.push(''); }
    }
    return { pages, count: doc.numPages };
  } finally {
    await closePdfDocument(loadingTask, doc);
  }
}

export async function getPdfPageCount(pdfSource) {
  const { loadingTask, doc } = await openPdf(pdfSource);
  const count = doc.numPages;
  await closePdfDocument(loadingTask, doc);
  return count;
}

/**
 * Renders a single PDF page to an HTMLCanvasElement at the given scale.
 * This is the `renderer` function expected by rasterizePdfPage().
 *
 * @param {File|Blob|ArrayBuffer|Uint8Array} pdfSource
 * @param {number} pageNumber 1-indexed
 * @param {number} [scale=2.5] Higher = better OCR, slower
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderPdfPageToCanvas(pdfSource, pageNumber, scale = 2.5) {
  const { loadingTask, doc } = await openPdf(pdfSource);
  try {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    await page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      background: 'rgba(255,255,255,1)',
    }).promise;

    return canvas;
  } finally {
    await closePdfDocument(loadingTask, doc);
  }
}

async function readSourceToArrayBuffer(source) {
  if (source instanceof ArrayBuffer) return source.slice(0);
  if (source instanceof Uint8Array) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  if (source instanceof File || source instanceof Blob) {
    return await source.arrayBuffer();
  }
  throw new Error('Unsupported PDF source type. Expected File, Blob, ArrayBuffer, or Uint8Array.');
}

export default {
  loadPdfjs,
  getPdfPageCount,
  renderPdfPageToCanvas,
  readPdfTextPages,
  resolvePdfDestroyTarget,
  closePdfDocument,
};
