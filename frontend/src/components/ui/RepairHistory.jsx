import React, { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { addRepair, readFile } from '../../lib/invoiceFiles.js';
import { DROPZONE_ACCEPT, MAX_FILE_SIZE_LABEL } from '../../lib/fileValidation.js';

export default function RepairHistory({ product }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rows = [...(product.repairHistory || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  async function submit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await addRepair(product.id, { date: data.get('date'), description: data.get('description').trim(), cost: data.get('cost') }, data.get('invoice'));
      setOpen(false);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function download(key) {
    setError('');
    try {
      const file = await readFile(product.id, key);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(file);
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (err) { setError(err.message); }
  }

  return <section className="data-card">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <h2 className="font-equinox text-white/70 text-xs tracking-widest">REPAIR HISTORY</h2>
      <button className="btn-ghost text-xs" disabled={busy} onClick={() => { setOpen(!open); setError(''); }}>
        <Plus size={14} /> {open ? 'Cancel' : 'Add repair invoice'}
      </button>
    </div>
    {open && <form onSubmit={submit} className="grid gap-3 mt-4 text-xs text-white/65">
      <label>Repair date<input required type="date" name="date" className="input-field w-full" /></label>
      <label>Work completed<input required name="description" maxLength={250} placeholder="e.g. Replaced battery" className="input-field w-full" /></label>
      <label>Cost (optional, ₹)<input name="cost" type="number" min="0" step="0.01" className="input-field w-full" /></label>
      <label>Repair invoice · up to {MAX_FILE_SIZE_LABEL}<input required type="file" name="invoice" accept={Object.keys(DROPZONE_ACCEPT).join(',')} className="input-field w-full" /></label>
      <button disabled={busy} className="btn-primary">{busy ? 'Saving…' : 'Save repair'}</button>
    </form>}
    {error && <p role="alert" className="text-sm text-white/70 mt-3">{error}</p>}
    {!rows.length && !open && <p className="text-white/40 text-sm mt-4">Add a service receipt to start this product’s repair history.</p>}
    {rows.map((r, i) => <div key={r.fileKey || i} className="mt-4 border-t border-white/10 pt-3">
      <p className="text-white/75 text-sm">{r.description || r.issueType?.replace(/_/g, ' ') || 'Repair'}</p>
      <p className="text-white/45 text-xs mt-1">{[r.date, r.cost != null && r.cost !== '' ? '₹' + r.cost : null].filter(Boolean).join(' · ')}</p>
      {r.fileKey && <button className="btn-ghost text-xs mt-2" onClick={() => download(r.fileKey)}><FileText size={13}/> Download invoice</button>}
    </div>)}
  </section>;
}
