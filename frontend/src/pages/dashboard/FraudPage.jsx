/**
 * FraudPage.jsx — Invoice fraud alerts and signal details.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle, Package, ChevronRight, ShieldOff } from 'lucide-react';
import { useStore } from '../../store/store.js';

import { invoiceIssue } from '../../lib/invoiceIssue.js';

const LEVEL_CONFIG = {
  CLEAN:       { label: 'Clean',       icon: CheckCircle,   color: 'rgba(255,255,255,0.3)' },
  SUSPICIOUS:  { label: 'Suspicious',  icon: AlertTriangle, color: 'rgba(255,255,255,0.6)' },
  HIGH_RISK:   { label: 'High Risk',   icon: AlertTriangle, color: 'rgba(255,255,255,0.8)' },
  FRAUDULENT:  { label: 'Fraudulent',  icon: ShieldOff,     color: 'rgba(255,255,255,0.95)' },
};

function FraudCard({ product }) {
  const level = product.fraudWarning || 'CLEAN';
  const cfg   = LEVEL_CONFIG[level] || LEVEL_CONFIG.SUSPICIOUS;
  const Icon  = cfg.icon;
  const signals = product.fraudSignals || [];

  return (
    <div className="data-card flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Package size={14} className="text-white/30" strokeWidth={1.5} />
          <div>
            <p className="text-white/75 text-sm font-medium">{product.productName || '—'}</p>
            <p className="text-white/25 text-xs">{product.brand || product.category || '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Icon size={14} style={{ color: cfg.color }} />
          <span className="text-xs font-mono tracking-[0.1em]" style={{ color: cfg.color }}>
            {cfg.label.toUpperCase()}
          </span>
        </div>
      </div>

      <p className="text-white/60 text-sm">{invoiceIssue(product)}</p>

      {/* Link */}
      <Link
        to={`/dashboard/products/${product.id}`}
        className="flex items-center gap-2 text-white/30 text-xs hover:text-white/60 transition-colors mt-1"
      >
        View product details <ChevronRight size={12} />
      </Link>
    </div>
  );
}

export default function FraudPage() {
  const { products } = useStore();

  const flagged = products
    .filter((p) => p.fraudWarning && p.fraudWarning !== 'CLEAN')
    .sort((a, b) => (b.fraudScore || 0) - (a.fraudScore || 0));

  const clean = products.filter((p) => p.fraudWarning === 'CLEAN');

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto page-enter">
      <div className="mb-8">
        <h1 className="font-equinox text-white mb-1" style={{ fontSize: '1.8rem', letterSpacing: '0.04em' }}>Fraud alerts</h1>
        <p className="text-white/35 text-sm">Invoice integrity analysis across your product portfolio.</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {[
          { label: 'Flagged invoices',  value: flagged.length, color: flagged.length > 0 ? 'rgba(255,255,255,0.9)' : undefined },
          { label: 'No flags',    value: clean.length },
          { label: 'Total analysed',    value: flagged.length + clean.length },
        ].map(({ label, value, color }) => (
          <div key={label} className="data-card">
            <p className="text-2xl font-light mb-1" style={{ color: color || 'rgba(255,255,255,0.8)' }}>{value}</p>
            <p className="text-white/30 text-xs">{label}</p>
          </div>
        ))}
      </div>

      {flagged.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <CheckCircle size={28} className="text-white/20 mb-4" strokeWidth={1} />
          <p className="text-white/40 text-sm mb-1">{clean.length ? 'No flagged invoices' : 'No invoices checked yet'}</p>
          <p className="text-white/20 text-xs">Scan a purchase invoice to check its details.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="font-equinox text-[10px] tracking-[0.2em] text-white/35">FLAGGED INVOICES</p>
          {flagged.map((p) => <FraudCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
}
