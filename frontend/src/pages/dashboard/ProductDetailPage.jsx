/**
 * ProductDetailPage.jsx
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Package, Shield, AlertTriangle, TrendingUp, Clock,
  Trash2, FileText, Calendar, Hash, Tag, Store,
  CheckCircle, XCircle, HelpCircle, ChevronRight,
  ExternalLink, Download, MessageSquare,
} from 'lucide-react';
import { useStore } from '../../store/store.js';
import { doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { deleteInvoice, getInvoice } from '../../lib/localFileStore.js';
import { productResearch } from '../../lib/api.js';
import { computeProductRisk } from '../../lib/engine/ai-engine/productRiskEngine.js';
import { getWarrantyTimeline } from '../../lib/warrantyStatus.js';
import { riskLevelLabelFor, riskColorFor } from '../../lib/engine/ai-engine/riskClassification.js';

function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <Icon size={14} className="text-white/25 shrink-0" strokeWidth={1.5} />
      <span className="text-white/35 text-xs w-28 shrink-0">{label}</span>
      <span className="text-white/70 text-sm flex-1">{value}</span>
    </div>
  );
}

function RiskGauge({ score }) {
  if (score == null) return null;
  const angle = (score / 100) * 180;
  const r = 36, cx = 44, cy = 44;
  const toXY = (deg) => {
    const rad = (deg - 180) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const start = toXY(0), end = toXY(angle);
  const large = angle > 180 ? 1 : 0;
  const path = `M ${toXY(0).x} ${toXY(0).y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
  const trackPath = `M ${toXY(0).x} ${toXY(0).y} A ${r} ${r} 0 1 1 ${toXY(180).x} ${toXY(180).y}`;

  const levelLabel = riskLevelLabelFor(score) || '—';
  const levelColor = riskColorFor(score);

  return (
    <div className="flex flex-col items-center">
      <svg width="88" height="52" viewBox="0 0 88 56">
        <path d={trackPath} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="4" strokeLinecap="round" />
        {score > 0 && <path d={path} fill="none" stroke={levelColor} strokeWidth="4" strokeLinecap="round" />}
      </svg>
      <p className="text-2xl font-light text-white -mt-2">{score}</p>
      <p className="text-[10px] font-mono tracking-[0.15em] mt-0.5" style={{ color: levelColor }}>{levelLabel}</p>
    </div>
  );
}

function WarrantyTimeline({ product, ws }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between text-xs">
        <span className="text-white/30">{product.purchaseDate || '—'}</span>
        <span className="text-white/30">{ws.expiryIso || '—'}</span>
      </div>
      <div style={{ height: '2px', background: 'rgba(255,255,255,0.06)', borderRadius: '1px' }}>
        <div
          style={{
            height: '100%',
            width: `${ws.pct}%`,
            background: ws.status === 'expired' ? 'rgba(255,255,255,0.2)' :
                        ws.status === 'expiring' ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.45)',
            borderRadius: '1px',
            transition: 'width 800ms ease',
          }}
        />
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-white/20">{ws.pct}% elapsed</span>
        <span style={{
          color: ws.status === 'expired' ? 'rgba(255,255,255,0.25)' :
                 ws.status === 'expiring' ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.45)',
        }}>
          {ws.status === 'expired'  && `Expired ${ws.days} days ago`}
          {ws.status === 'expiring' && `${ws.days} days remaining`}
          {ws.status === 'active'   && `${ws.days} days remaining`}
          {ws.status === 'unknown'  && 'Duration unknown'}
        </span>
      </div>
    </div>
  );
}

function FraudBadge({ level, score }) {
  // No fraud analysis was run — do NOT claim the invoice is verified.
  if (!level && score == null) {
    return (
      <div className="flex items-center gap-2">
        <HelpCircle size={14} className="text-white/30" />
        <span className="text-white/40 text-xs">Integrity not assessed</span>
      </div>
    );
  }
  // Fraud analysis ran and found no signals. Extraction quality and
  // internal consistency are NOT proof of authenticity — say so.
  if (!level || level === 'CLEAN') {
    return (
      <div className="flex items-center gap-2">
        <CheckCircle size={14} className="text-white/40" />
        <span className="text-white/40 text-xs">Consistency check passed — no fraud signals</span>
      </div>
    );
  }
  const icons = { SUSPICIOUS: HelpCircle, HIGH_RISK: AlertTriangle, FRAUDULENT: XCircle };

const RESEARCH_COLORS = {
  recall:     'rgba(239,68,68,0.9)',
  advisory:   'rgba(250,204,21,0.9)',
  reliability: 'rgba(251,146,60,0.9)',
};
  const Icon = icons[level] || AlertTriangle;
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-[8px]"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
    >
      <Icon size={14} className="text-white/60 shrink-0" />
      <span className="text-white/60 text-sm">Invoice flagged: <span className="text-white/80 font-medium">{level}</span></span>
      <Link to="/dashboard/fraud" className="ml-auto text-white/30 hover:text-white/60 transition-colors">
        <ChevronRight size={14} />
      </Link>
    </div>
  );
}

export default function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { products, deleteProduct, updateProduct, addNotification } = useStore();
  const { user } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [invoiceUrl, setInvoiceUrl] = useState(null);
  const [invoiceAvailable, setInvoiceAvailable] = useState(false);
  const [researchEvidence, setResearchEvidence] = useState([]);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState(null);
  const [recomputing, setRecomputing] = useState(false);
  const [recomputeError, setRecomputeError] = useState(null);

  const product = products.find((p) => p.id === id);

  useEffect(() => { window.scrollTo(0, 0); }, [id]);

  useEffect(() => {
    let objectUrl = null;
    let active = true;
    if (!user || !id) return undefined;
    getInvoice(user.uid, id).then((invoice) => {
      if (!active || !invoice?.file) return;
      objectUrl = URL.createObjectURL(invoice.file);
      setInvoiceUrl(objectUrl);
      setInvoiceAvailable(true);
    }).catch(() => { if (active) setInvoiceAvailable(false); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [user?.uid, id]);

  // Lazy internet research for recalls / advisories on this product.
  const loadResearch = useCallback(async () => {
    if (!product?.productName || researchLoading) return;
    setResearchLoading(true);
    setResearchError(null);
    try {
      const res = await productResearch({
        productName: product.productName,
        brand: product.brand || undefined,
      });
      setResearchEvidence(Array.isArray(res.evidence) ? res.evidence : []);
    } catch (err) {
      setResearchError(err.message || 'Research unavailable.');
    } finally {
      setResearchLoading(false);
    }
  }, [product?.productName, product?.brand, researchLoading]);

  useEffect(() => {
    const t = setTimeout(() => { loadResearch(); }, 800);
    return () => clearTimeout(t);
  }, [loadResearch]);

  // Deterministic risk recompute from the CURRENT stored product data.
  const handleRecomputeRisk = async () => {
    if (!product) return;
    setRecomputing(true);
    setRecomputeError(null);
    try {
      const input = {
        productName: product.productName,
        brand: product.brand,
        category: product.category,
        purchaseDate: product.purchaseDate,
        warrantyMonths: product.warrantyMonths || null,
        overallConfidence: product.overallConfidence ?? null,
        price: product.price ?? product.purchasePrice ?? null,
        seller: product.seller ?? null,
        invoiceNumber: product.invoiceNumber ?? null,
        serialNumber: product.serialNumber ?? null,
      };
      const fraudReport = (product.fraudScore != null && product.fraudScore > 0)
        ? { fraudScore: product.fraudScore, signals: product.fraudSignals || [], warningLevel: product.fraudWarning }
        : null;
      const r = computeProductRisk(input, new Date(), { fraudReport });
      const patch = {
        riskScore: r.riskScore,
        riskLevel: r.riskLevel,
        riskLevelLabel: r.riskLevelLabel,
        riskReason: r.riskReason,
        riskConfidence: r.riskConfidence,
        riskFactors: r.riskFactors,
        riskEvidence: r.riskEvidence,
        riskWarnings: r.riskWarnings,
        riskRecommendation: r.recommendation,
        riskLastCalculatedAt: r.riskLastCalculatedAt,
        risk: r,
      };
      await updateDoc(doc(db, 'products', product.id), patch);
      updateProduct(product.id, patch);
      addNotification({ type: 'info', message: 'Risk score recomputed from current data.' });
    } catch (err) {
      console.error(err);
      setRecomputeError(err.message || 'Recompute failed.');
    } finally {
      setRecomputing(false);
    }
  };

  const riskFactors = product?.riskFactors
    ?? product?.risk?.riskFactors
    ?? product?.risk?.factors
    ?? [];

  if (!product) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-64">
        <p className="text-white/30 text-sm mb-4">Product not found.</p>
        <Link to="/dashboard/products" className="btn-ghost text-sm">Back to products</Link>
      </div>
    );
  }

  const ws = getWarrantyTimeline(product);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'products', product.id));
      if (user) await deleteInvoice(user.uid, product.id).catch(() => {});
      deleteProduct(product.id);
      addNotification({ type: 'info', message: `${product.productName} removed.` });
      navigate('/dashboard/products', { replace: true });
    } catch (err) {
      console.error(err);
      setDeleting(false);
      setShowConfirm(false);
    }
  };

  const statusColor = {
    active:   'rgba(255,255,255,0.5)',
    expiring: 'rgba(255,255,255,0.85)',
    expired:  'rgba(255,255,255,0.2)',
    unknown:  'rgba(255,255,255,0.15)',
  }[ws.status];

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto page-enter">
      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-white/30 text-xs hover:text-white/60 transition-colors mb-8"
      >
        <ArrowLeft size={14} /> Products
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-6 mb-8">
        <div className="flex items-start gap-5">
          <div
            className="w-12 h-12 rounded-[10px] flex items-center justify-center shrink-0"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <Package size={20} className="text-white/40" strokeWidth={1.5} />
          </div>
          <div>
            <h1
              className="font-equinox text-white mb-1"
              style={{ fontSize: 'clamp(1.2rem, 2.5vw, 1.8rem)', letterSpacing: '0.04em', lineHeight: 1.2 }}
            >
              {product.productName || 'Unnamed Product'}
            </h1>
            <div className="flex items-center gap-3 flex-wrap">
              {product.brand && <span className="text-white/40 text-sm">{product.brand}</span>}
              {product.category && (
                <>
                  <span className="text-white/15">·</span>
                  <span className="text-white/30 text-sm">{product.category}</span>
                </>
              )}
              <span className="text-white/15">·</span>
              <span className="text-xs font-mono tracking-[0.1em]" style={{ color: statusColor }}>
                {ws.status.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowConfirm(true)}
            className="p-2.5 rounded-[8px] text-white/25 hover:text-white/60 transition-colors"
            style={{ border: '1px solid rgba(255,255,255,0.07)' }}
            title="Delete product"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Delete confirm */}
      {showConfirm && (
        <div
          className="mb-6 p-5 rounded-[10px] flex items-center justify-between gap-4"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <p className="text-white/60 text-sm">Delete <span className="text-white/80 font-medium">{product.productName}</span>? This cannot be undone.</p>
          <div className="flex gap-2">
            <button onClick={() => setShowConfirm(false)} className="btn-ghost text-xs py-2 px-4">Cancel</button>
            <button onClick={handleDelete} disabled={deleting} className="btn-primary text-xs py-2 px-4">
              {deleting ? <div className="w-3 h-3 border border-black/20 border-t-black/60 rounded-full animate-spin" /> : 'Delete'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — main info */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Warranty timeline */}
          <div className="data-card">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-equinox text-white/70 text-xs tracking-[0.12em]">WARRANTY STATUS</h2>
              <Shield size={15} className="text-white/20" strokeWidth={1.5} />
            </div>
            <WarrantyTimeline product={product} ws={ws} />
          </div>

          {/* Product info */}
          <div className="data-card">
            <h2 className="font-equinox text-white/70 text-xs tracking-[0.12em] mb-2">PRODUCT DETAILS</h2>
            <div>
              <InfoRow icon={Calendar}  label="Purchase date"   value={product.purchaseDate} />
              <InfoRow icon={Shield}    label="Warranty"        value={product.warrantyMonths ? `${product.warrantyMonths} months` : null} />
              <InfoRow icon={Hash}      label="Invoice no."     value={product.invoiceNumber} />
              <InfoRow icon={Hash}      label="Serial no."      value={product.serialNumber} />
              <InfoRow icon={Store}     label="Seller"          value={product.seller} />
              <InfoRow icon={Tag}       label="Category"        value={product.category} />
              {product.price && <InfoRow icon={FileText} label="Price" value={product.price} />}
            </div>
            {product.notes && (
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <p className="text-white/25 text-xs mb-2">NOTES</p>
                <p className="text-white/50 text-sm leading-relaxed">{product.notes}</p>
              </div>
            )}
          </div>

          {/* Fraud status */}
          <div className="data-card">
            <h2 className="font-equinox text-white/70 text-xs tracking-[0.12em] mb-4">INVOICE INTEGRITY</h2>
              <FraudBadge level={product.fraudWarning} score={product.fraudScore} />
            {product.overallConfidence != null && (
              <div className="mt-4 flex items-center gap-3">
                <span className="text-white/25 text-xs">Extraction confidence</span>
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div style={{
                    width: `${Math.round(product.overallConfidence * 100)}%`,
                    height: '1px',
                    background: 'rgba(255,255,255,0.4)',
                  }} />
                </div>
                <span className="text-white/30 text-xs font-mono">{Math.round(product.overallConfidence * 100)}%</span>
              </div>
            )}
          </div>

          {/* Repair history */}
          <div className="data-card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-equinox text-white/70 text-xs tracking-[0.12em]">REPAIR HISTORY</h2>
            </div>
            {(!product.repairHistory || product.repairHistory.length === 0) ? (
              <p className="text-white/20 text-sm">No repairs recorded.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {product.repairHistory.map((r, i) => (
                  <div key={i} className="flex items-start gap-4 py-3" style={{ borderBottom: i < product.repairHistory.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                    <div className="w-1 h-1 rounded-full bg-white/30 mt-2 shrink-0" />
                    <div className="flex-1">
                      <p className="text-white/60 text-sm">{r.description || r.issueType?.replace(/_/g, ' ') || 'Repair'}</p>
                      <p className="text-white/25 text-xs mt-0.5">{r.date} {r.cost ? `· ₹${r.cost}` : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Invoice */}
          {(invoiceAvailable || product.invoiceStoredLocally) && (
            <div className="data-card">
              <h2 className="font-equinox text-white/70 text-xs tracking-[0.12em] mb-4">INVOICE DOCUMENT</h2>
              {invoiceUrl ? <div className="flex gap-3">
                <a href={invoiceUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost text-xs py-2 px-4">
                  <ExternalLink size={13} /> View invoice
                </a>
                <a href={invoiceUrl} download={product.invoiceFilename || 'invoice'} className="btn-ghost text-xs py-2 px-4">
                  <Download size={13} /> Download
                </a>
              </div> : <p className="text-white/25 text-sm">This invoice is stored only on the browser where it was uploaded.</p>}
            </div>
          )}
        </div>

        {/* Right column — stats */}
        <div className="flex flex-col gap-4">
          {/* Risk score */}
          {product.riskScore != null && (
            <div className="data-card flex flex-col items-center py-6">
              <p className="font-equinox text-white/40 text-[10px] tracking-[0.15em] mb-4">RISK SCORE</p>
              <RiskGauge score={product.riskScore} />
              <p className="text-white/25 text-xs mt-3 font-mono">
                {product.riskLevelLabel ?? product.riskLevel ?? '—'}
              </p>
              {product.riskReason && (
                <p className="text-white/20 text-[11px] mt-1 leading-relaxed max-w-[230px]">
                  {product.riskReason}
                </p>
              )}
              {product.riskConfidence != null && (
                <p className="text-white/20 text-[11px] mt-1">
                  Confidence {Math.round(product.riskConfidence * 100)}%
                </p>
              )}
              {product.riskRecommendation && (
                <p className="text-white/30 text-xs text-center mt-4 leading-relaxed">{product.riskRecommendation}</p>
              )}

              {/* Factor breakdown */}
              {riskFactors.length > 0 && (
                <div className="w-full mt-5 flex flex-col gap-2">
                  <p className="font-equinox text-white/30 text-[10px] tracking-[0.15em]">FACTOR BREAKDOWN</p>
                  {riskFactors.map((f) => (
                    <div key={f.name} className="flex flex-col gap-1">
                      <div className="flex items-center gap-3">
                        <span className="w-36 text-left text-[11px] text-white/45 truncate">{f.name}</span>
                        <div className="flex-1 h-[3px] rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.min(100, Math.max(0, f.contribution))}%`,
                              background: f.contribution >= 50 ? 'rgba(239,68,68,0.7)'
                                : f.contribution >= 25 ? 'rgba(250,204,21,0.7)'
                                  : 'rgba(52,211,153,0.6)',
                            }}
                          />
                        </div>
                        <span className="w-8 text-right text-[11px] font-mono text-white/35">{f.contribution}</span>
                      </div>
                      {f.warrantyEndIso && f.daysRemaining != null && (
                        <p className="text-[10px] text-white/30 leading-snug">
                          {f.daysRemaining > 0
                            ? `${f.daysRemaining} day${f.daysRemaining === 1 ? '' : 's'} remaining${f.totalWarrantyDays > 0 ? ` · ${((f.daysRemaining / f.totalWarrantyDays) * 100).toFixed(1)}% of term` : ''} · ends ${f.warrantyEndIso}`
                            : `warranty ended ${f.warrantyEndIso}`}
                        </p>
                      )}
                      {f.explanation && (
                        <p className="text-[10px] text-white/25 leading-snug">{f.explanation}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Evidence used */}
              {Array.isArray(product.riskEvidence) && product.riskEvidence.length > 0 && (
                <div className="w-full mt-4 text-left">
                  <p className="font-equinox text-white/30 text-[10px] tracking-[0.15em] mb-2">EVIDENCE USED</p>
                  <ul className="flex flex-col gap-1.5">
                    {product.riskEvidence.map((e, i) => (
                      <li key={i} className="flex items-start gap-2 text-[11px] text-white/40">
                        <span className="w-1 h-1 rounded-full bg-white/25 mt-1.5 shrink-0" />
                        <span>{e.description}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Missing evidence warnings */}
              {Array.isArray(product.riskWarnings) && product.riskWarnings.length > 0 && (
                <div className="w-full mt-3 text-left">
                  <p className="font-equinox text-white/30 text-[10px] tracking-[0.15em] mb-2">MISSING EVIDENCE</p>
                  <ul className="flex flex-col gap-1.5">
                    {product.riskWarnings.map((w, i) => (
                      <li key={i} className="flex items-start gap-2 text-[11px] text-amber-200/40">
                        <span className="w-1 h-1 rounded-full bg-amber-200/40 mt-1.5 shrink-0" />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Recompute */}
              <button
                onClick={handleRecomputeRisk}
                disabled={recomputing}
                className="btn-ghost text-[11px] mt-5 py-2 px-4"
              >
                {recomputing ? 'Recomputing…' : '↻ Recompute with current data'}
              </button>
              {recomputeError && <p className="text-red-300/50 text-[10px] mt-2">{recomputeError}</p>}
            </div>
          )}

          {/* Quick actions */}
          <div className="data-card">
            <p className="font-equinox text-white/40 text-[10px] tracking-[0.15em] mb-4">QUICK ACTIONS</p>
            <div className="flex flex-col gap-2">
              <Link
                to="/dashboard/agent"
                className="flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-sm text-white/50 hover:text-white/80 hover:bg-white/05 transition-all"
              >
                <MessageSquare size={15} className="shrink-0" />
                Ask AI about this product
              </Link>
              <Link
                to="/dashboard/upload"
                className="flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-sm text-white/50 hover:text-white/80 hover:bg-white/05 transition-all"
              >
                <FileText size={15} className="shrink-0" />
                Upload new invoice
              </Link>
            </div>
          </div>

          {/* Warranty card */}
          <div
            className="rounded-[12px] p-5 flex flex-col gap-3"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <p className="font-equinox text-white/40 text-[10px] tracking-[0.15em]">WARRANTY EXPIRY</p>
            {ws.expiry ? (
              <>
                <p className="text-white/70 text-sm">{ws.expiry.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                <p className="text-xs" style={{ color: statusColor }}>
                  {ws.status === 'expired'  && `Expired ${ws.days} days ago`}
                  {ws.status === 'expiring' && `⚠ ${ws.days} days remaining`}
                  {ws.status === 'active'   && `${ws.days} days remaining`}
                </p>
              </>
            ) : (
              <p className="text-white/25 text-sm">—</p>
            )}
          </div>
        </div>

        {/* Internet research — lazy, runs AFTER the deterministic score */}
        <div className="data-card mt-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-equinox text-white/70 text-xs tracking-[0.12em]">INTERNET RESEARCH</h2>
            <button
              onClick={loadResearch}
              disabled={researchLoading}
              className="btn-ghost text-[11px] py-1.5 px-3"
            >
              {researchLoading ? 'Searching…' : '↻ Refresh'}
            </button>
          </div>
          {researchError && <p className="text-red-300/50 text-xs mb-3">{researchError}</p>}
          {researchEvidence.length === 0 && !researchLoading && !researchError ? (
            <p className="text-white/20 text-sm">
              No internet research yet — searches for recalls, advisories and known reliability issues on this product.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {researchEvidence.map((e, i) => (
                <a
                  key={i}
                  href={e.url || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-4 py-3 px-2 -mx-2 rounded hover:bg-white/[0.03] transition-colors"
                  style={{ borderBottom: i < researchEvidence.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}
                >
                  <span
                    className="mt-1.5 shrink-0 text-[9px] font-mono uppercase px-2 py-0.5 rounded-full border"
                    style={{
                      color: RESEARCH_COLORS[e.category] ?? 'rgba(255,255,255,0.4)',
                      borderColor: (RESEARCH_COLORS[e.category] ?? 'rgba(255,255,255,0.2)'),
                    }}
                  >
                    {e.category}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-white/70 text-sm leading-snug">{e.title}</p>
                    {e.snippet && <p className="text-white/30 text-xs mt-1">{e.snippet}</p>}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
