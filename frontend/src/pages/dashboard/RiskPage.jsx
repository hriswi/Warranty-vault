import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CircleCheck, CircleAlert } from 'lucide-react';
import { useStore } from '../../store/store.js';
import { cleanTitle } from '../../lib/invoiceEvidence.js';
import { getWarrantyTimeline } from '../../lib/warrantyStatus.js';

import { riskCards } from '../../lib/riskRecords.js';

function Detail({label, children}) {
  return <div className="min-w-0">
    <dt className="text-xs text-white/60">{label}</dt>
    <dd className="mt-1 text-sm text-white/90 break-words">{children || 'Unavailable'}</dd>
  </div>;
}

export default function RiskPage() {
  const products = useStore(state => state.products);
  const cards = riskCards(products);

  return <main className="p-5 sm:p-8 max-w-5xl mx-auto page-enter">
    <h1 className="font-equinox text-white text-3xl mb-6">Risk analysis</h1>
    {!cards.length && <div className="section-card">
      <p className="text-white/80 mb-4">Add an invoice to see its assessment here.</p>
      <Link to="/dashboard/upload" className="btn-ghost">Add invoice</Link>
    </div>}
    <div className="space-y-4 font-sans">
      {cards.map(({product, report, findings, status}) => {
        const warranty = getWarrantyTimeline(product);
        const coverage = {unknown:'Unverified',active:'Active',expiring:'Expiring soon',expired:'Expired'}[warranty.status];
        const StatusIcon = status === 'Needs checking' ? CircleAlert : CircleCheck;
        return <article key={product.id} className="rounded-xl border border-white/15 bg-neutral-900 p-5 sm:p-6">
          <header className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold leading-snug text-white">{cleanTitle(product.productName || '') || 'Unnamed product'}</h2>
            <span className="inline-flex items-center gap-2 text-sm text-white/85">
              {report || findings.length ? <StatusIcon size={16} aria-hidden="true" /> : null}{status}
            </span>
          </header>
          {!!findings.length && <ul className="mt-4 space-y-2 border-l-2 border-white/55 pl-4 text-sm leading-6 text-white/90">
            {findings.map(line => <li key={line}>{line}</li>)}
          </ul>}
          {report?.notes?.map(note => <p key={note} className="mt-2 text-sm leading-6 text-white/75">{note}</p>)}
          {!report && <p className="mt-3 text-sm text-white/70">Open the product and reanalyze its original invoice.</p>}
          <dl className="mt-5 grid gap-4 border-t border-white/10 pt-4 sm:grid-cols-3">
            <Detail label="Purchase date">{product.purchaseDate}</Detail>
            <Detail label="Serial number / IMEI">{product.serialNumber}</Detail>
            <Detail label="Warranty">{coverage}{warranty.expiryIso && ' · ' + warranty.expiryIso}</Detail>
          </dl>
          <footer className="mt-5 flex flex-wrap items-start justify-between gap-3 text-sm">
            {!!report?.verified?.length && <details className="text-white/70">
              <summary className="cursor-pointer">Invoice fields{report.pageNumber ? ' · Page ' + report.pageNumber : ''}</summary>
              <ul className="mt-2 space-y-1">{report.verified.map(field => <li key={field}>{field}</li>)}</ul>
            </details>}
            <Link to={'/dashboard/products/' + product.id} className="ml-auto inline-flex items-center gap-1 text-white/85 underline underline-offset-4">View product <ArrowUpRight size={14} /></Link>
          </footer>
        </article>;
      })}
    </div>
  </main>;
}
