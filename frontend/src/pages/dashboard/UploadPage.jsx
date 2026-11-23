/**
 * UploadPage.jsx
 * 500 KB hard limit enforced at: dropzone validator, onChange, pre-OCR, pre-Firebase.
 * Two-mode workflow: Upload Invoice (default) vs Enter Manually.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Upload, FileText, Image as ImageIcon, X, Check, ShieldCheck, Info,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useStore } from '../../store/store.js';
import { invoiceIssue } from '../../lib/invoiceIssue.js';
import { getInvoice } from '../../lib/localFileStore.js';
import { readFile, saveProduct } from '../../lib/invoiceFiles.js';
import {
  validateFile, validateFileSync, dropzoneValidator,
  MAX_FILE_SIZE_BYTES, MAX_FILE_SIZE_LABEL, ALLOWED_FORMATS_LABEL, DROPZONE_ACCEPT,
  formatBytes, fileSizePercent,
} from '../../lib/fileValidation.js';
import { isPdfFile } from '../../lib/engine/ocr/ocrEngine.js';
import { mapInvoiceToFormFields } from '../../lib/invoiceFormMapper.js';
import { CATEGORIES } from '../../lib/engine/classifier/productDatabase.js';

import DatePicker from '../../components/ui/DatePicker.jsx';
import { productPages, assessInvoice } from '../../lib/invoiceEvidence.js';

const CATEGORY_LIST = Object.freeze(Object.values(CATEGORIES));

function friendlyStage(raw, isPdf) {
  if (!raw) return isPdf ? 'Rendering PDF…' : 'Extracting text…';
  const s = raw.toLowerCase();
  if (s.includes('pdf')) return 'Rendering PDF…';
  if (s.includes('finaliz')) return 'Finalizing…';
  if (s.includes('reading invoice') || s.includes('recognizing') || s.includes('preparing')) return 'Extracting text…';
  if (s.includes('loading') || s.includes('initializing') || s.includes('warming')) return 'Reading invoice…';
  return 'Extracting text…';
}

function friendlyPdfError(message) {
  const raw = String(message || '');
  if (!raw || /destroy is not a function|is not a function/i.test(raw)) {
    return 'Could not read this PDF. Try uploading it again, or enter the details manually.';
  }
  return raw;
}

function Field({ label, required, confidence, missing, children }) {
  const pct = confidence != null ? Math.round(confidence * 100) : null;
  const isLow = pct != null && pct < 50;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label
          className="text-xs font-medium uppercase tracking-[0.08em]"
          style={{ color: missing ? 'rgba(255,183,77,0.85)' : 'rgba(255,255,255,0.4)' }}
        >
          {label}{required && <span className="text-white/25 ml-1">*</span>}
          {missing && (
            <span className="ml-2 text-[9px] font-mono text-amber-300/80 tracking-normal">– missing</span>
          )}
        </label>
        {pct != null && (
          <span className="text-[10px] font-mono" style={{ color: isLow ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.2)' }}>
            auto-extracted
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function FileSizeBar({ bytes }) {
  const pct = fileSizePercent(bytes);
  const over = pct >= 100;
  return (
    <div className="mt-3 w-full">
      <div className="flex justify-between text-[11px] mb-1.5">
        <span style={{ color: over ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)' }}>
          {formatBytes(bytes)}
        </span>
        <span className="text-white/20">max {MAX_FILE_SIZE_LABEL}</span>
      </div>
      <div style={{ height: '2px', background: 'rgba(255,255,255,0.07)', borderRadius: '1px' }}>
        <div style={{
          width: `${Math.min(100, pct)}%`,
          height: '100%',
          background: over ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)',
          borderRadius: '1px',
          transition: 'width 300ms ease',
        }} />
      </div>
    </div>
  );
}

function ModeTabs({ mode, setMode }) {
  return (
    <div className="flex gap-2 p-1 rounded-[10px] w-fit mb-8" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <button
        type="button"
        onClick={() => setMode('invoice')}
        className={`px-4 py-2 rounded-[8px] text-xs font-medium tracking-[0.06em] uppercase transition-all ${mode === 'invoice' ? '' : 'text-white/35 hover:text-white/60'}`}
        style={mode === 'invoice' ? { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.85)' } : {}}
      >
        <span className="flex items-center gap-2">
          <Upload size={13} strokeWidth={1.5} />
          Upload Invoice
        </span>
      </button>
      <button
        type="button"
        onClick={() => setMode('manual')}
        className={`px-4 py-2 rounded-[8px] text-xs font-medium tracking-[0.06em] uppercase transition-all ${mode === 'manual' ? '' : 'text-white/35 hover:text-white/60'}`}
        style={mode === 'manual' ? { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.85)' } : {}}
      >
        <span className="flex items-center gap-2">
          <FileText size={13} strokeWidth={1.5} />
          Enter Manually
        </span>
      </button>
    </div>
  );
}

export default function UploadPage() {
  const [params] = useSearchParams();
  const id = params.get('edit');
  const product = useStore(state => state.products.find(p => p.id === id));
  if (id && !product) return <p className="p-8 text-white/50">Product details unavailable.</p>;
  return <InvoiceForm key={id || 'new'} existing={product} />;
}

function InvoiceForm({ existing }) {
  const { user } = useAuth();
  const { addNotification } = useStore();
  const navigate = useNavigate();

  const [mode, setMode] = useState('invoice');

  const [file,           setFile]           = useState(null);
  const [preview,        setPreview]        = useState(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const [processing,     setProcessing]     = useState(false);
  const [progress,       setProgress]       = useState(0);
  const [stage,          setStage]          = useState('');
  const [processed,      setProcessed]      = useState(false);
  const [extracted,      setExtracted]      = useState(null);
  const [fieldConf,      setFieldConf]      = useState({});
  const [overallConf,    setOverallConf]    = useState(null);
  const [fraudWarning,   setFraudWarning]   = useState(null);
  const [pipelineResult, setPipelineResult] = useState(null);
  const [validationError,setValidationError]= useState('');

  const [form, setForm] = useState(() => Object.fromEntries(
    ['productName', 'brand', 'category', 'purchaseDate', 'warrantyMonths', 'invoiceNumber',
     'serialNumber', 'seller', 'price', 'notes', 'orderNumber', 'model', 'currency'].map(key => [key, String(existing?.[key] ?? '')])
  ));

  const userEditedRef = useRef(new Set());
  const reviewingOriginal = useRef(false);

  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState('');
  const busy = useRef(false);
  const [choices,setChoices] = useState([]);
  function chooseInvoice(inv) {
    const patch = mapInvoiceToFormFields(inv, {allowedCategories:CATEGORY_LIST});
    setForm(prev => {
      const next = {...prev};
      for (const key of ['productName','brand','model','category','currency','price','orderNumber','serialNumber','invoiceNumber','warrantyMonths','seller','purchaseDate']) {
        if (!userEditedRef.current.has(key) && !(reviewingOriginal.current && prev[key])) next[key] = patch[key] ?? '';
      }
      return next;
    });
    setExtracted(inv); setProcessed(true); setChoices([]);
    const assessment = assessInvoice(inv);
    setStage([...assessment.issues,...assessment.notes].join(' ') || 'Review the extracted details.');
  }

  const setField = (key) => (e) => {
    const value = e?.target?.value ?? '';
    userEditedRef.current.add(key);
    setForm((p) => ({ ...p, [key]: value }));
  };

  const resetInvoiceState = useCallback(() => {
    setFile(null); setPreview(null); setExtracted(null);
    setFieldConf({}); setOverallConf(null); setPipelineResult(null);
    setFraudWarning(null); setProcessed(false); setProcessing(false);
    setProgress(0); setStage(''); setValidationError('');
    setChoices([]);
  }, []);

  const switchMode = (nextMode) => {
    if (processing || saving) return;
    setMode(nextMode);
    if (nextMode === 'manual') {
      resetInvoiceState();
    }
  };

  const onDrop = useCallback(async (accepted, rejected) => {
    setValidationError('');
    if (rejected.length > 0) {
      const err = rejected[0].errors[0];
      setValidationError(
        err.code === 'file-too-large'
          ? `File exceeds the maximum allowed size of ${MAX_FILE_SIZE_LABEL}. Your file is ${formatBytes(rejected[0].file.size)}.`
          : err.code === 'file-invalid-type'
          ? `File type not allowed. Accepted formats: ${ALLOWED_FORMATS_LABEL}.`
          : err.message
      );
      return;
    }
    if (!accepted.length) return;

    const f = accepted[0];
    const validation = await validateFile(f);
    if (!validation.valid) {
      setValidationError(validation.error);
      return;
    }

    if (busy.current) return;
    reviewingOriginal.current = false;
    setFile(f);
    setExtracted(null); setFieldConf({}); setOverallConf(null);
    setFraudWarning(null); setPipelineResult(null); setProcessed(false);
    setProgress(0); setStage(''); setValidationError('');

    if (f.type.startsWith('image/')) {
      setPreview(URL.createObjectURL(f));
    } else {
      setPreview(null);
    }
    await runOcrPipeline(f);
  }, []);

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: DROPZONE_ACCEPT,
    maxSize: MAX_FILE_SIZE_BYTES,
    disabled: processing || saving,
    maxFiles: 1,
    multiple: false,
    validator: dropzoneValidator,
  });

  const runOcrPipeline = async (file) => {
    if (!file || busy.current) return;
    const guard = validateFileSync(file);
    if (!guard.valid) { setValidationError(guard.error); return; }

    busy.current = true; setChoices([]);
    setProcessing(true); setProgress(0); setStage('');
    setError(''); setValidationError('');
    setProcessed(false); setExtracted(null); setFieldConf({}); setOverallConf(null);
    setPipelineResult(null); setFraudWarning(null);

    const isPdf = isPdfFile(file);

    try {
      setStage('Uploading…'); setProgress(3);

      const { extractInvoiceText } = await import('../../lib/warrantyEngine.js');

      const startTime = Date.now();
      setStage(isPdf ? 'Rendering PDF…' : 'Reading invoice…'); setProgress(8);

      const ocrResult = await extractInvoiceText(file, {
        lang: 'eng', collectPages: true,
        onProgress: ({ stage: s, progress: p }) => {
          if (s) setStage(friendlyStage(s, isPdf));
          if (typeof p === 'number') setProgress(Math.min(55, 5 + Math.round(p * 50)));
        },
      });

      const candidates = productPages(ocrResult.pageTexts || [ocrResult.rawText || '']);
      if (!candidates.length) setValidationError('No product invoice identified. Review the product name, date, invoice number and price.');
      else if (candidates.length > 1) setChoices(candidates);
      else chooseInvoice(candidates[0]);
      setProgress(100);
    } catch (err) {
      console.error('[OCR Pipeline] failed:', err);
      let userMsg = 'OCR processing failed. You can still fill in the details manually.';
      let stageMsg = 'Processing failed.';
      if (err?.name === 'OcrError') {
        switch (err.code) {
          case 'PDF_LOAD_FAILED':
            userMsg = friendlyPdfError(err.message) || 'Could not read this PDF. It may be corrupted or password-protected. You can enter the details manually.';
            stageMsg = 'Failed to read PDF.';
            break;
          case 'PDF_RENDER_FAILED':
            userMsg = `Failed to render the PDF page: ${err.message || 'Try re-saving the PDF and uploading again.'}`;
            stageMsg = 'PDF rendering failed.';
            break;
          case 'WORKER_INIT_FAILED':
            userMsg = `Could not start the OCR engine: ${err.message || 'Please refresh the page and try again.'}`;
            stageMsg = 'Engine failed to start.';
            break;
          case 'RECOGNITION_FAILED':
            userMsg = `OCR failed while reading: ${err.message || 'Try a clearer scan or photo of the invoice.'}`;
            stageMsg = 'Recognition failed.';
            break;
          case 'NO_INPUT':
            userMsg = 'No file was provided. Please select an invoice first.';
            stageMsg = 'No file selected.';
            break;
          default:
            userMsg = `${err.message || userMsg}`;
        }
      } else if (err?.message) {
        userMsg = err.message;
      }
      setStage(stageMsg);
      setValidationError(userMsg);
      setProgress(0);
    } finally {
      busy.current = false; setProcessing(false);
    }
  };


  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.productName.trim()) { setError('Product name is required.'); return; }
    setError(''); setSaving(true);

    try {
      if (!user) throw new Error('Sign in before saving a product.');
      const productData = {
        userId:            user.uid,
        productName:       form.productName.trim(),
        brand:             form.brand.trim(),
        category:          form.category,
        purchaseDate:      form.purchaseDate,
        warrantyMonths:    form.warrantyMonths ? parseInt(form.warrantyMonths) : null,
        model: form.model || null,
        currency: form.currency || null,
        orderNumber: form.orderNumber || null,
        invoiceNumber:     form.invoiceNumber.trim(),
        serialNumber:      form.serialNumber.trim(),
        seller:            form.seller.trim(),
        price:             form.price.trim(),
        notes:             form.notes.trim(),
        ...(extracted ? {invoiceEvidence: extracted, invoiceAssessment: assessInvoice(extracted), warrantyStartDate: extracted.warrantyStartDate || null} : {}),
        ...(!existing || file ? {
          ...(!extracted ? {invoiceEvidence:null, invoiceAssessment:null,warrantyStartDate:null} : {}),
          invoiceInCloud: Boolean(file),
          invoiceStoredLocally: false,
          invoiceFilename: file?.name || null,
          invoiceMimeType: file?.type || null,
          invoiceSize: file?.size || null,
          overallConfidence: overallConf,
          fieldConfidence:   fieldConf,
          fraudWarning:      pipelineResult?.fraud?.warningLevel ?? fraudWarning,
          fraudScore:        pipelineResult?.fraud?.fraudScore ?? null,
          fraudSignals:      pipelineResult?.fraud?.signals ?? [],
          riskScore:         pipelineResult?.risk?.riskScore ?? null,
          riskLevel:         pipelineResult?.risk?.riskLevel ?? null,
          riskLevelLabel:    pipelineResult?.risk?.riskLevelLabel ?? null,
          riskReason:        pipelineResult?.risk?.riskReason ?? null,
          riskConfidence:    pipelineResult?.risk?.riskConfidence ?? null,
          riskEvidence:      pipelineResult?.risk?.riskEvidence ?? [],
          riskWarnings:      pipelineResult?.risk?.riskWarnings ?? [],
          riskLastCalculatedAt: pipelineResult?.risk?.riskLastCalculatedAt ?? null,
          riskRecommendation: pipelineResult?.risk?.recommendation ?? null,
          risk:              pipelineResult?.risk ?? null,
          fraud:             pipelineResult?.fraud ?? null,
          advisory:          pipelineResult?.advisory ?? null,
        } : {}),
      };

      const id = await saveProduct(existing?.id, productData, file);
      addNotification({ type: 'success', message: existing ? 'Invoice updated.' : 'Product added.' });
      setSaved(true);
      navigate(`/dashboard/products/${id}`);
    } catch (err) {
      setError(err?.message || 'Failed to save. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const clearFile = (e) => {
    if (e) e.stopPropagation();
    if (processing || saving) return;
    resetInvoiceState();
  };

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto page-enter">
      <div className="mb-6">
        <h1 className="font-equinox text-white mb-2" style={{ fontSize: '1.8rem', letterSpacing: '0.04em' }}>
          {existing ? 'Update current invoice' : 'Add product'}
        </h1>
        <p className="text-white/35 text-sm">
          {mode === 'invoice'
            ? existing ? 'Edit the saved details or upload a replacement invoice.' : 'Upload an invoice and the engine extracts every detail automatically.'
            : 'Manual entry skips the invoice scan. Risk and fraud checks require a scanned invoice.'}
        </p>
      </div>

      {existing && mode === 'invoice' && !file && <button type="button" className="btn-ghost" disabled={processing} onClick={async () => {
        try {
          const original = existing.invoiceInCloud ? await readFile(existing.id,'purchase') : (await getInvoice(user.uid,existing.id))?.file;
          if (!original) throw new Error('Original invoice unavailable. Upload it to check the purchase details.');
          reviewingOriginal.current = true;
          await runOcrPipeline(original);
        } catch (err) { setValidationError(err.message); }
      }}>Reanalyze original invoice</button>}
      <ModeTabs mode={mode} setMode={switchMode} />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {mode === 'invoice' && (
          <div className="lg:col-span-2 flex flex-col gap-4">
            <div
              {...getRootProps()}
              className="relative rounded-[12px] cursor-pointer transition-all duration-200 overflow-hidden"
              style={{
                border: validationError ? '1px solid rgba(255,255,255,0.3)' :
                        isDragActive    ? '1px solid rgba(255,255,255,0.25)' :
                                          '1px dashed rgba(255,255,255,0.1)',
                background: validationError ? 'rgba(255,255,255,0.03)' :
                            isDragActive    ? 'rgba(255,255,255,0.04)' :
                                             'rgba(255,255,255,0.02)',
                minHeight: '200px',
              }}
            >
              <input {...getInputProps()} />

              {preview ? (
                <div className="relative">
                  <img src={preview} alt="Invoice preview" className="w-full object-cover" style={{ maxHeight: '220px' }} />
                  <button
                    type="button"
                    onClick={clearFile}
                    className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center"
                    style={{ background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.15)' }}
                  >
                    <X size={13} className="text-white" />
                  </button>
                  {file && <FileSizeBar bytes={file.size} />}
                </div>
              ) : file ? (
                <div className="px-6 py-10 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <FileText size={20} className="text-white/30" />
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <span className="text-white/70 text-xs truncate">{file.name}</span>
                      <span className="text-white/20 text-[11px]">{formatBytes(file.size)}</span>
                    </div>
                    <button type="button" onClick={clearFile} className="text-white/25 hover:text-white/60 transition-colors">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                  <Upload size={26} className="text-white/20 mb-4" strokeWidth={1} />
                  <p className="text-white/45 text-sm mb-1.5">
                    {isDragActive ? 'Drop to upload' : 'Drag invoice here'}
                  </p>
                  <p className="text-white/20 text-xs mb-1">{ALLOWED_FORMATS_LABEL}</p>
                  <p className="text-white/15 text-xs">Max {MAX_FILE_SIZE_LABEL}</p>
                </div>
              )}
            </div>

            {file && !processing && !processed && (
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-[8px]"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <Check size={13} className="text-white/50 shrink-0" />
                <p className="text-white/60 text-xs">Invoice ready — process it to extract the details.</p>
              </div>
            )}

            {file && !processed && (
              <button
                type="button"
                disabled={processing || !file}
                onClick={() => runOcrPipeline(file)}
                className="btn-primary w-full flex items-center justify-center gap-2"
                style={{ opacity: processing ? 0.6 : 1 }}
              >
                {processing ? (
                  <>
                    <div className="w-4 h-4 border border-black/20 border-t-black/60 rounded-full animate-spin shrink-0" />
                    {stage || 'Processing…'}
                  </>
                ) : (
                  <>
                    <Check size={14} strokeWidth={2} />
                    Retry extraction
                  </>
                )}
              </button>
            )}

            {validationError && (
              <div
                className="flex items-start gap-3 px-4 py-3 rounded-[8px]"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' }}
              >
                <Info size={14} className="text-white/60 shrink-0 mt-0.5" />
                <p className="text-white/60 text-xs leading-relaxed">{validationError}</p>
              </div>
            )}

            {stage && processing && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 border border-white/20 border-t-white/60 rounded-full animate-spin shrink-0" />
                  <p className="text-white/45 text-xs">{stage}</p>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            {!processing && processed && (
              <div
                className="flex items-start gap-3 px-4 py-3 rounded-[8px]"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <Check size={13} className="text-white/50 shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1">
                  <p className="text-white/70 text-xs leading-relaxed">
                    Review the extracted details before saving.
                  </p>
                  <p className="text-white/25 text-[11px]">{stage}</p>
                </div>
              </div>
            )}

            {choices.length > 0 && <div className="data-card"><p>Choose the purchased product</p>{choices.map((inv,i)=><button type="button" key={i} className="btn-ghost" onClick={()=>chooseInvoice(inv)}>Page {inv.pageNumber} · {inv.productName || inv.invoiceNumber || "Review invoice"}</button>)}</div>}

            <div
              className="flex items-start gap-3 px-4 py-3 rounded-[8px]"
              style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <ShieldCheck size={13} className="text-white/25 shrink-0 mt-0.5" />
              <p className="text-white/25 text-[11px] leading-relaxed">
                Files are validated for size, type, and content signature before processing.
                Invoices are saved privately to your account. Max {MAX_FILE_SIZE_LABEL}.
              </p>
            </div>

            {fraudWarning && fraudWarning !== 'CLEAN' && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-[6px]"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <Info size={13} className="text-white/50 shrink-0" />
                <div>
                  <p className="text-white/65 text-xs">Check this invoice</p>
                  <p className="text-white/35 text-[11px] mt-1 leading-relaxed">
                    {invoiceIssue({ fraud: pipelineResult?.fraud, fraudWarning })}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSave} className={`${mode === 'invoice' ? 'lg:col-span-3' : 'lg:col-span-5'} flex flex-col gap-5`}>
          <Field label="Product name" required confidence={fieldConf.productName} missing={processed && !form.productName}>
            <input type="text" value={form.productName} onChange={setField('productName')} placeholder="e.g. Sony WH-1000XM5 Headphones" className="input-field" />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Brand" confidence={fieldConf.brand} missing={processed && !form.brand}>
              <input type="text" value={form.brand} onChange={setField('brand')} placeholder="e.g. Sony" className="input-field" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Purchase date" confidence={fieldConf.purchaseDate} missing={processed && !form.purchaseDate}>
              <DatePicker
                value={form.purchaseDate}
                onChange={(purchaseDate) => {
                  userEditedRef.current.add('purchaseDate');
                  setForm((p) => ({ ...p, purchaseDate }));
                }}
              />
            </Field>
            <Field label="Warranty (months)" confidence={fieldConf.warrantyMonths} missing={false}>
              <input type="number" value={form.warrantyMonths} onChange={setField('warrantyMonths')} placeholder="Enter confirmed months" min="1" max="240" className="input-field" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Invoice number" confidence={fieldConf.invoiceNumber} missing={processed && !form.invoiceNumber}>
              <input type="text" value={form.invoiceNumber} onChange={setField('invoiceNumber')} placeholder="INV-001" className="input-field" />
            </Field>
            <Field label="Serial number / IMEI (optional)" confidence={fieldConf.serialNumber} missing={false}>
              <input type="text" value={form.serialNumber} onChange={setField('serialNumber')} placeholder="SN-XXXXXXXXX" className="input-field" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Purchase price" confidence={fieldConf.purchasePrice} missing={processed && !form.price}>
              <input type="text" value={form.price} onChange={setField('price')} placeholder="₹ 0.00" className="input-field" />
            </Field>
          </div>


          {error && (
            <p className="text-xs px-4 py-3 rounded-[8px]"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving || saved || processing || choices.length > 0} className="btn-primary flex-1">
              {saved   ? <><Check size={15} /> Saved</>
              : saving  ? <div className="w-4 h-4 border border-black/20 border-t-black/60 rounded-full animate-spin" />
              : existing ? 'Save changes' : 'Save product'}
            </button>
            <button type="button" onClick={() => navigate(existing ? `/dashboard/products/${existing.id}` : '/dashboard')} className="btn-ghost px-5">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

