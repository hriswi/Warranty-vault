/**
 * ProductDetailPage.jsx
 */
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Package, Shield, AlertTriangle, TrendingUp, Clock,
  Pencil, Trash2, FileText, Calendar, Hash, Tag, Store,
  CheckCircle, XCircle, HelpCircle, ChevronRight,
  ExternalLink, Download, MessageSquare, ShieldCheck,
} from 'lucide-react';
import { useStore } from '../../store/store.js';
import { readFile, removeProduct } from '../../lib/invoiceFiles.js';
import RepairHistory from '../../components/ui/RepairHistory.jsx';
import { formatInrPrice } from '../../lib/invoiceFormMapper.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { getInvoice } from '../../lib/localFileStore.js';
import { productContact } from '../../lib/brandContacts.js';
import { getWarrantyTimeline } from '../../lib/warrantyStatus.js';



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

function WarrantyTimeline({ product, ws }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between text-xs">
        <span className="text-white/30">{product.purchaseDate || '—'}</span>
        <span className="text-white/30">{ws.expiryIso || '—'}</span>
      </div>
      {ws.expiry && <div role="meter" aria-label="Warranty term used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ws.percentUsed}
        aria-valuetext={ws.daysRemaining < 0 ? 'Expired' : ws.days + ' days remaining'}
        className="relative h-2 rounded-full bg-white/10">
        <div className="h-full rounded-full bg-white/[0.55]" style={{ width: ws.percentUsed + '%' }} />
        <span className="absolute top-1/2 h-3 w-3 rounded-full border-2 border-neutral-800 bg-white -translate-x-1/2 -translate-y-1/2" style={{ left: ws.percentUsed + '%' }} />
      </div>}
      <div className="text-right text-xs">
        <span style={{
          color: ws.status === 'expired' ? 'rgba(255,255,255,0.25)' :
                 ws.status === 'expiring' ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.45)',
        }}>
          {ws.status === 'expired'  && `Expired ${ws.days} days ago`}
          {ws.status === 'expiring' && `${ws.days} days remaining`}
          {ws.status === 'active'   && `${ws.days} days remaining`}
          {ws.status === 'unknown' && (product.warrantyMonths ? 'Warranty unverified. Check the purchase date.' :
            'Warranty coverage unverified. ' + (product.purchaseDate && Date.parse(product.purchaseDate) < Date.now() ? 'Purchased ' + new Date(product.purchaseDate).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric', timeZone:'UTC' }) + '. ' : '') + 'No warranty period is recorded. Check the manufacturer’s terms and enter the duration to calculate expiry.')}
        </span>
      </div>
    </div>
  );
}



export default function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { products, deleteProduct, addNotification } = useStore();
  const { user } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [params] = useSearchParams();
  const [showConfirm, setShowConfirm] = useState(params.get('confirm') === 'delete');
  const [invoiceUrl, setInvoiceUrl] = useState(null);
  const [invoiceAvailable, setInvoiceAvailable] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const product = products.find((p) => p.id === id);

  useEffect(() => { window.scrollTo(0, 0); }, [id]);

  useEffect(() => {
    let objectUrl = null;
    let active = true;
    if (!user || !id) return undefined;
    setInvoiceUrl(null);
    setInvoiceAvailable(false);
    if (!product?.invoiceInCloud && !product?.invoiceStoredLocally) return;
    const invoiceRequest = product.invoiceInCloud
      ? readFile(id, 'purchase').then(file => ({ file }))
      : getInvoice(user.uid, id);
    invoiceRequest.then((invoice) => {
      if (!active || !invoice?.file) return;
      objectUrl = URL.createObjectURL(invoice.file);
      setInvoiceUrl(objectUrl);
      setInvoiceAvailable(true);
    }).catch(() => { if (active) setInvoiceAvailable(false); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [user?.uid, id, product?.invoiceInCloud, product?.invoiceStoredLocally, product?.updatedAt]);

  if (!product) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-64">
        <p className="text-white/30 text-sm mb-4">Product not found.</p>
        <Link to="/dashboard/products" className="btn-ghost text-sm">Back to products</Link>
      </div>
    );
  }

  const contact = productContact(product);
  const ws = getWarrantyTimeline(product);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await removeProduct(product);
      deleteProduct(product.id);
      addNotification({ type: 'info', message: `${product.productName} removed.` });
      navigate('/dashboard/products', { replace: true });
    } catch (err) {
      console.error(err);
      setDeleteError(err.message || 'Could not delete product.');
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
                {({unknown:'Warranty Unverified',expired:'Warranty Expired',active:'Warranty Active',expiring:'Expiring Soon'})[ws.status]}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link to={`/dashboard/upload?edit=${id}`} title="Edit invoice" aria-label="Edit invoice" className="btn-ghost p-2.5"><Pencil size={15}/></Link>
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

      {deleteError && <p role="alert">{deleteError}</p>}
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
              <InfoRow icon={Hash} label="Order no." value={product.orderNumber} />
              <InfoRow icon={Hash}      label="Serial no."      value={product.serialNumber} />
              <InfoRow icon={Store}     label="Seller"          value={product.seller} />
              <InfoRow icon={Tag}       label="Category"        value={product.category} />
              {product.price && <InfoRow icon={FileText} label="Price" value={formatInrPrice(product.price)} />}
            </div>
            {product.notes && (
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <p className="text-white/25 text-xs mb-2">NOTES</p>
                <p className="text-white/50 text-sm leading-relaxed">{product.notes}</p>
              </div>
            )}
          </div>

          <RepairHistory key={product.id} product={product} />

          {/* Invoice */}
          {(invoiceAvailable || product.invoiceInCloud || product.invoiceStoredLocally) && (
            <div className="data-card">
              <h2 className="font-equinox text-white/70 text-xs tracking-[0.12em] mb-4">INVOICE DOCUMENT</h2>
              {invoiceUrl ? <div className="flex gap-3">
                <a href={invoiceUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost text-xs py-2 px-4">
                  <ExternalLink size={13} /> View invoice
                </a>
                <a href={invoiceUrl} download={product.invoiceFilename || 'invoice'} className="btn-ghost text-xs py-2 px-4">
                  <Download size={13} /> Download
                </a>
              </div> : <p className="text-white/25 text-sm">{product.invoiceInCloud ? 'Invoice unavailable. Refresh to retry.' : 'Open the uploading browser to view this older invoice.'}</p>}
            </div>
          )}
        </div>

        {/* Right column — stats */}
        <div className="flex flex-col gap-4">
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
                to={`/dashboard/upload?edit=${id}`}
                className="flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-sm text-white/50 hover:text-white/80 hover:bg-white/05 transition-all"
              >
                <FileText size={15} className="shrink-0" />
                Update current invoice
              </Link>
              {contact && <a href={contact.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-sm text-white/50 hover:text-white/80 hover:bg-white/05">
                <ExternalLink size={15} /> Contact {contact.name} support
              </a>}
              {contact?.checkUrl && <a href={contact.checkUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-sm text-white/50 hover:text-white/80 hover:bg-white/05">
                <ShieldCheck size={15} /> {contact.checkLabel}
              </a>}
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

      </div>
    </div>
  );
}

