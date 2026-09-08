/**
 * pdfRenderer.js
 *
 * pdf.js-backed PDF page rasterizer for the OCR pipeline.
 * Runs entirely in the browser — no Node APIs, no backend.
 *
 * Vite wiring: the worker script is imported with the `?url` suffix so
 * Vite emits it as a static asset and gives us its URL. Assigning that
 * URL to GlobalWorkerOptions.workerSrc is the supported way to run
 * pdf.js with a bundled worker (importing the worker module directly
 * and assigning the module object breaks at runtime).
 */

let pdfjsLibPromise = null;

async function loadPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      try {
        const workerUrl = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;
      } catch (_) {
        // If the ?url import is unavailable, fall back to the package's
        // own CDN mirror. Never pretend the worker loaded.
        try {
          pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
        } catch (__) { /* leave unset — getDocument will fail loudly */ }
      }
      return pdfjs;
    })();
  }
  return pdfjsLibPromise;
}

export async function getPdfPageCount(pdfSource) {
  const pdfjs = await loadPdfjs();
  const data = await readSourceToArrayBuffer(pdfSource);
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const count = doc.numPages;
  try { await doc.destroy(); } catch (_) { /* ignore */ }
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
  const pdfjs = await loadPdfjs();
  const data = await readSourceToArrayBuffer(pdfSource);

  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
  });

  let doc = null;
  let page = null;
  try {
    doc = await loadingTask.promise;
    page = await doc.getPage(pageNumber);

    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    await page.render({
      canvasContext: ctx,
      viewport,
      background: 'rgba(255,255,255,1)',
    }).promise;

    return canvas;
  } finally {
    try { if (page) await page.cleanup(); } catch (_) { /* ignore */ }
    try { if (doc) await doc.destroy(); } catch (_) { /* ignore */ }
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
};
