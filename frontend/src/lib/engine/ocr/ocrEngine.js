/**
 * ocrEngine.js
 *
 * Real OCR pipeline built on Tesseract.js (no paid/cloud OCR APIs).
 *
 * This module owns the boundary between "raw file" and "raw text".
 * It is intentionally dumb about invoices/warranties — its only job
 * is: given an image (or a single page rendered from a PDF), return
 * the most reliable text Tesseract can extract, plus useful metadata
 * (per-word confidence, low-confidence regions) that downstream parsers
 * can use to decide how much to trust a given match.
 *
 * Supported inputs:
 *  - Browser: File / Blob (from <input type="file">), HTMLCanvasElement,
 *    HTMLImageElement, ImageData, or a data URL string.
 *  - Node:   file path string, or a Buffer (e.g. from multer / fs.readFile).
 *
 * PDF handling:
 *  - Tesseract.js does not parse PDFs directly. PDFs must be rasterized
 *    to images (one per page) before OCR. This module exposes a clean
 *    seam (`rasterizePdfPage`) for that step and documents exactly which
 *    library to wire it to, rather than silently no-op'ing or faking it.
 */

import { createWorker } from 'tesseract.js';
import { renderPdfPageToCanvas, readPdfTextPages, getPdfPageCount } from './pdfRenderer.js';
import { parseInvoice } from '../parsers/invoiceParser.js';

/**
 * Default Tesseract recognition options tuned for invoices/receipts:
 * mostly printed text, mixed font sizes, often low-contrast thermal
 * prints or phone-camera photos of paper receipts.
 *
 * Optimizations for speed:
 *  - PSM 6: assume a single uniform block of text (faster, good for invoices)
 *  - OEM 3: default LSTM engine (fastest available)
 *  - Disable unnecessary features when we just want raw text
 */
const DEFAULT_TESSERACT_OPTIONS = {
  lang: 'eng',
  tessedit_pageseg_mode: '6',
  tessedit_ocr_engine_mode: '3',
  hOCR_charinfo_enable: '0',
  textord_heavy_nr: '0',
  textord_min_linesize: '2.5',
};

/**
 * Internal singleton worker pool. Spinning up a Tesseract worker has
 * real startup cost (loads the WASM core + language traineddata), so
 * for an app that OCRs many invoices in a session we reuse a worker
 * instead of creating/terminating one per call.
 */
let workerPromise = null;
let workerInitPromise = null;

function withTimeout(promise, milliseconds, code, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new OcrError(code, message)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

async function getWorker(lang = 'eng', onProgress) {
  if (!workerPromise) {
    if (!workerInitPromise) {
      workerInitPromise = (async () => {
        try {
          const worker = await createWorker(lang, 1, {
            logger: (m) => {
              try {
                if (m.status === 'loading tesseract core') onProgress?.({ stage: 'Loading OCR engine…', progress: 0.05 });
                else if (m.status === 'initializing tesseract') onProgress?.({ stage: 'Initializing engine…', progress: 0.12 });
                else if (m.status === 'loading language traineddata') onProgress?.({ stage: 'Loading language data…', progress: 0.25 + (m.progress || 0) * 0.2 });
                else if (m.status === 'initializing api') onProgress?.({ stage: 'Warming up…', progress: 0.5 });
                else if (m.status === 'recognizing text') onProgress?.({ stage: 'Reading invoice…', progress: 0.55 + (m.progress || 0) * 0.45 });
              } catch (_) { /* ignore progress reporting errors */ }
            },
          });
          try {
            await worker.setParameters({
              tessedit_pageseg_mode: DEFAULT_TESSERACT_OPTIONS.tessedit_pageseg_mode,
              tessedit_ocr_engine_mode: DEFAULT_TESSERACT_OPTIONS.tessedit_ocr_engine_mode,
            });
          } catch (_) { /* non-critical if params fail */ }
          workerPromise = Promise.resolve(worker);
          workerInitPromise = null;
          return worker;
        } catch (err) {
          workerInitPromise = null;
          throw err;
        }
      })();
    }
    return workerInitPromise;
  }
  return workerPromise;
}

/**
 * Releases the underlying Tesseract worker and its WASM memory.
 * Call this when the user navigates away from the upload flow entirely
 * (not between individual uploads), to avoid the cost of re-initializing.
 */
export async function terminateOcrEngine() {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}

/**
 * Runs OCR on a single image input and returns structured results.
 *
 * @param {File|Blob|HTMLCanvasElement|HTMLImageElement|ImageData|string|Buffer} image
 * @param {object} options
 * @param {string} [options.lang='eng']
 * @param {string} [options.pageSegMode] Tesseract PSM override.
 * @param {number} [options.minWordConfidence=60] Words below this confidence
 *        (0-100) are flagged as low-confidence rather than discarded, so
 *        the caller/UI can highlight them for manual correction.
 * @returns {Promise<{
 *   rawText: string,
 *   confidence: number,
 *   words: Array<{ text: string, confidence: number, bbox: object }>,
 *   lowConfidenceWords: Array<{ text: string, confidence: number }>,
 *   lines: Array<{ text: string, confidence: number }>,
 *   engine: 'tesseract.js'
 * }>}
 */
async function preprocessImageForOcr(image) {
  try {
    if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') {
      return image;
    }
    if (image instanceof File || image instanceof Blob) {
      const bitmap = await createImageBitmap(image);
      const maxDim = 1800;
      let { width, height } = bitmap;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      if (scale < 1) {
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: false });
      ctx.drawImage(bitmap, 0, 0, width, height);
      if (typeof bitmap.close === 'function') try { bitmap.close(); } catch (_) { /* ignore */ }
      return canvas;
    }
    if (image instanceof HTMLImageElement) {
      const maxDim = 1800;
      let { naturalWidth: width, naturalHeight: height } = image;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      if (scale < 1) {
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: false });
        ctx.drawImage(image, 0, 0, width, height);
        return canvas;
      }
    }
  } catch (_) { /* fallback: use the original image */ }
  return image;
}

export async function extractTextFromImage(image, options = {}) {
  if (!image) {
    throw new OcrError('NO_INPUT', 'No image, file, or buffer was provided to the OCR engine.');
  }

  const lang = options.lang || DEFAULT_TESSERACT_OPTIONS.lang;
  const minWordConfidence = options.minWordConfidence ?? 60;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  onProgress?.({ stage: 'Preparing image…', progress: 0.02 });
  const preparedImage = await preprocessImageForOcr(image);

  let worker;
  try {
    worker = await withTimeout(getWorker(lang, onProgress), 45000, 'WORKER_INIT_TIMEOUT', 'OCR startup took too long. Check your connection and try again.');
  } catch (err) {
    throw new OcrError(
      'WORKER_INIT_FAILED',
      `Failed to initialize the Tesseract OCR worker: ${err.message}`
    );
  }

  if (options.pageSegMode) {
    try {
      await worker.setParameters({ tessedit_pageseg_mode: options.pageSegMode });
    } catch (_) { /* non-critical */ }
  }

  let result;
  try {
    if (onProgress) {
      onProgress({ stage: 'Reading invoice text…', progress: 0.55 });
    }
    result = await withTimeout(worker.recognize(preparedImage), 90000, 'RECOGNITION_TIMEOUT', 'OCR took too long. Try a clearer, smaller image or enter the details manually.');
  } catch (err) {
    throw new OcrError(
      'RECOGNITION_FAILED',
      `Tesseract failed to process the provided image: ${err.message}`
    );
  }

  onProgress?.({ stage: 'Finalizing extraction…', progress: 0.97 });

  const data = result?.data || {};
  const rawText = data.text || '';

  // Flatten word-level confidence data across all blocks/paragraphs/lines.
  const words = [];
  const lines = [];

  try {
    const blocks = data.blocks || [];
    for (const block of blocks) {
      for (const paragraph of block.paragraphs || []) {
        for (const line of paragraph.lines || []) {
          lines.push({
            text: (line.text || '').trim(),
            confidence: line.confidence ?? 0,
          });
          for (const word of line.words || []) {
            words.push({
              text: word.text,
              confidence: word.confidence ?? 0,
              bbox: word.bbox,
            });
          }
        }
      }
    }

    // Fallback: some Tesseract.js builds return data.words directly
    if (words.length === 0 && Array.isArray(data.words)) {
      for (const word of data.words) {
        words.push({
          text: word.text,
          confidence: word.confidence ?? 0,
          bbox: word.bbox,
        });
      }
    }
  } catch (_) { /* ignore flattening errors — rawText is the critical output */ }

  const lowConfidenceWords = words.filter((w) => w.confidence < minWordConfidence);

  return {
    rawText,
    confidence: typeof data.confidence === 'number' ? data.confidence : averageConfidence(words),
    words,
    lowConfidenceWords,
    lines,
    engine: 'tesseract.js',
  };
}

function averageConfidence(words) {
  if (!words.length) return 0;
  const sum = words.reduce((acc, w) => acc + (w.confidence || 0), 0);
  return Math.round((sum / words.length) * 100) / 100;
}

/**
 * Custom error type so calling code (UI layer) can distinguish
 * "OCR engine broke" from "this just isn't readable text" and show
 * an appropriate message instead of a generic failure.
 */
export class OcrError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OcrError';
    this.code = code;
  }
}

function pdfLoadFailureMessage(err) {
  const raw = String(err?.message || err || '');
  if (/destroy is not a function/i.test(raw)) {
    return 'Could not finish reading this PDF. Try uploading it again, or enter the details manually.';
  }
  if (raw) return `Failed to read the PDF: ${raw}`;
  return 'Failed to read the PDF. The file may be corrupted or password-protected.';
}

/**
 * Detects whether a given uploaded file is a PDF based on MIME type
 * and/or filename extension (defensive: some browsers report PDFs
 * inconsistently, especially when forwarded from camera scanner apps).
 */
export function isPdfFile(file) {
  if (!file) return false;
  const mime = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  return mime === 'application/pdf' || name.endsWith('.pdf');
}

/**
 * Rasterizes a single PDF page to a canvas/image that Tesseract can
 * consume. Tesseract.js has no native PDF support, so PDFs MUST go
 * through this step first.
 *
 * Real implementation wiring (intentionally left as a clear seam rather
 * than silently faked): use pdf.js (`pdfjs-dist`, MIT licensed, free)
 * to render the requested page onto an OffscreenCanvas/HTMLCanvasElement
 * at a resolution high enough for OCR (200-300 DPI equivalent), then
 * hand that canvas to `extractTextFromImage`.
 *
 * This function performs input validation and orchestration; the actual
 * pdf.js render call is injected via `renderer` so this module has zero
 * hard dependency on pdfjs-dist (kept out of this package's deps to
 * avoid bundling a large PDF renderer into a module whose core job is OCR).
 *
 * @param {File|Blob|ArrayBuffer} pdfSource
 * @param {number} pageNumber 1-indexed page number.
 * @param {object} options
 * @param {(pdfSource: any, pageNumber: number, scale: number) => Promise<HTMLCanvasElement|OffscreenCanvas>} options.renderer
 *        Required. Caller supplies a pdf.js-backed renderer function.
 * @param {number} [options.scale=2.5] Render scale; higher = better OCR accuracy, slower.
 */
export async function rasterizePdfPage(pdfSource, pageNumber = 1, options = {}) {
  if (!pdfSource) {
    throw new OcrError('NO_INPUT', 'No PDF source provided for rasterization.');
  }
  const renderer = typeof options.renderer === 'function' ? options.renderer : renderPdfPageToCanvas;
  const scale = options.scale || 2.5;
  const canvas = await renderer(pdfSource, pageNumber, scale);
  if (!canvas) {
    throw new OcrError('PDF_RENDER_FAILED', `Failed to rasterize PDF page ${pageNumber}.`);
  }
  return canvas;
}

/**
 * High-level convenience function: takes ANY supported invoice source
 * (image file, or PDF + renderer) and returns extracted text, handling
 * the PDF rasterization step transparently if needed.
 *
 * This is the function the upload UI should call.
 */
export async function extractInvoiceText(file, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  if (isPdfFile(file)) {
    let numPages, pages;
    try {
      onProgress?.({ stage: 'Reading PDF…', progress: 0.02 });
      ({ count: numPages, pages } = await readPdfTextPages(file, options.maxPdfPages ?? Infinity));
    } catch (err) {
      try {
        numPages = await getPdfPageCount(file);
        pages = [];
      } catch {
        throw new OcrError('PDF_LOAD_FAILED', pdfLoadFailureMessage(err));
      }
    }

    const maxPages = Math.max(1, Math.min(numPages, options.maxPdfPages ?? Infinity));
    const perPageWeight = 0.85 / maxPages;
    const baseProgress = 0.05;

    // Extract text per page (embedded text layer where usable, else OCR),
    // then pick the single page that is the actual product invoice.
    // Concatenating every page into one blob mixes fields across separate
    // invoices (e.g. a packaging-fee invoice and the real product invoice in
    // the same PDF), so each page is parsed independently and the strongest
    // product-invoice page wins.
    const pageTexts = [];
    const pageOcrResults = [];
    for (let i = 1; i <= maxPages; i++) {
      const pageBaseP = baseProgress + ((i - 1) * perPageWeight);
      onProgress?.({
        stage: maxPages > 1 ? `Reading PDF page ${i}/${maxPages}…` : 'Rendering PDF page…',
        progress: Math.min(0.9, pageBaseP),
      });

      const embedded = (pages[i - 1] || '').trim();
      const embeddedUsable =
        embedded.length >= 80 &&
        /\d/.test(embedded) &&
        /invoice|warranty|serial|purchase|amount|total/i.test(embedded) &&
        !embedded.includes('\uFFFD');

      let pageText = '';
      let ocrResult = null;
      if (embeddedUsable) {
        pageText = embedded;
      } else {
        const canvas = await rasterizePdfPage(file, i, { ...options, pageNumber: i });

        const pageOcrOptions = {
          ...options,
          onProgress: ({ stage: s, progress: p }) => {
            if (s) {
              onProgress?.({
                stage: maxPages > 1 ? `Page ${i}: ${s}` : s,
                progress: Math.min(0.9, pageBaseP + (p * perPageWeight * 0.9)),
              });
            }
          },
        };

        ocrResult = await extractTextFromImage(canvas, pageOcrOptions);
        pageText = (ocrResult?.rawText || '').trim();

        try {
          if (canvas instanceof HTMLCanvasElement) {
            const ctx = canvas.getContext('2d');
            if (ctx) try { ctx.clearRect(0, 0, canvas.width, canvas.height); } catch (_) { /* ignore */ }
            canvas.width = 1; canvas.height = 1;
          }
        } catch (_) { /* ignore cleanup */ }
      }

      pageTexts[i - 1] = pageText;
      pageOcrResults[i - 1] = ocrResult;
    }

    if (options.collectPages) return { pageTexts, pdfTotalPages: numPages };

    // Select the page that looks like the real product invoice: a detected
    // product name wins, then invoice number, then overall parse confidence.
    let bestIndex = 0;
    let bestScore = -1;
    for (let i = 0; i < maxPages; i++) {
      const text = pageTexts[i] || '';
      if (!text) continue;
      let score = 0;
      try {
        const parsed = parseInvoice(text);
        if (parsed.productName) score += 3;
        if (parsed.invoiceNumber) score += 1;
        score += parsed.overallConfidence || 0;
      } catch (_) { /* unparseable page — score stays 0 */ }
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    const combinedText = pageTexts[bestIndex] || '';
    const chosenOcr = pageOcrResults[bestIndex] || null;
    let chosenConfidence = 0;
    if (chosenOcr && typeof chosenOcr.confidence === 'number') {
      chosenConfidence = chosenOcr.confidence;
    } else {
      try {
        chosenConfidence = parseInvoice(combinedText).overallConfidence || 0;
      } catch (_) { /* keep 0 */ }
    }

    onProgress?.({ stage: 'Finalizing extraction…', progress: 0.97 });

    return {
      rawText: combinedText,
      pageTexts,
      confidence: chosenConfidence,
      words: chosenOcr ? (chosenOcr.words || []) : [],
      lowConfidenceWords: chosenOcr ? (chosenOcr.lowConfidenceWords || []) : [],
      lines: chosenOcr ? (chosenOcr.lines || []) : [],
      engine: chosenOcr ? 'tesseract.js' : 'pdf.js',
      pdfPagesProcessed: maxPages,
      pdfTotalPages: numPages,
    };
  }

  return extractTextFromImage(file, options);
}

export default {
  extractTextFromImage,
  extractInvoiceText,
  rasterizePdfPage,
  isPdfFile,
  terminateOcrEngine,
  OcrError,
};
