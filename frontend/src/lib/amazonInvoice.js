export function readAmazonInvoice(text = '') {
  if (!/amazon\.in/i.test(text) || !/Order Number\s*:/i.test(text) || !/Sold By\s*:/i.test(text)) return null;
  const match = re => text.match(re)?.[1]?.trim() || null;
  const invoiceNumber = match(/\bInvoice Number\s*:\s*([A-Z0-9]+-[A-Z0-9-]*\d)\b/i);
  const orderNumber = match(/\bOrder Number\s*:\s*(\d{3}-\d{7}-\d{7})\b/i);
  const seller = match(/Sold By\s*:\s*([^\r\n]*[a-z][^\r\n]*)/i);
  const date = text.match(/Invoice Date\s*:\s*(\d{2})[.-](\d{2})[.-](\d{4})/i);
  const iso = date && [date[3], date[2], date[1]].join('-');
  const parsed = iso && new Date(iso + 'T00:00:00Z');
  const purchaseDate = parsed && Number.isFinite(+parsed) && parsed.toISOString().startsWith(iso) ? iso : null;
  const item = text.match(/^\s*\d+\s+([A-Za-z][\w -]{2,80}?)\s*\(([^()]{1,160})\)/m);
  const model = item?.[1]?.trim() || null;
  const specs = item?.[2]?.replace(/\s+/g, ' ').replace(/RAM\s+(?=\d+\s*GB)/i, 'RAM, ').trim();
  const brand = model?.match(/^(Redmi|Xiaomi|Samsung|Apple|Motorola|OnePlus|Realme|Lenovo|HP|Dell|Sony)\b/i)?.[1] || null;
  const category = /^(Redmi Note|Samsung Galaxy S\d|Apple iPhone|Motorola Moto G)/i.test(model || '') ? 'Smartphone' : null;
  const totals = match(/^\s*TOTAL\s*:\s*([^\r\n]+)/im)?.match(/(?:₹|INR|Rs\.?)\s*[\d,]+(?:\.\d{2})?/gi);
  const amount = totals?.at(-1)?.replace(/[^\d.]/g, '');
  let serialNumber = match(/(?:serial\s*(?:number|no\.?)|IMEI)\s*:\s*([A-Z0-9-]{5,30})\b/i);
  return { productName: model && specs ? model + ' (' + specs + ')' : model, model, brand, category, seller, purchaseDate, invoiceNumber, orderNumber,
    purchasePrice: amount ? Number(amount) : null, currency: amount ? 'INR' : null,
    warrantyMonths: amazonWarrantyMonths(text),
    serialNumber };
}

function amazonWarrantyMonths(text) {
  const device = text.match(/(\d+)\s*(years?|months?)\s+(?:manufacturer(?:'s)?\s+)?warranty\s+for\s+(?:the\s+)?(?:device|product|handset|phone)\b/i);
  if (device) return Number(device[1]) * (/year/i.test(device[2]) ? 12 : 1);
  for (const m of text.matchAll(/(\d+)\s*(years?|months?)\s+(?:manufacturer(?:'s)?\s+)?warranty\b/gi)) {
    const ctx = text.slice(m.index, m.index + m[0].length + 48);
    if (/accessor|in-?box/i.test(ctx)) continue;
    return Number(m[1]) * (/year/i.test(m[2]) ? 12 : 1);
  }
  const term = text.match(/(?:manufacturer(?:'s)?\s+)?warranty\s*[:\-]?\s*(\d+)\s*(months?|years?)\b/i);
  if (!term) return null;
  if (/accessor|in-?box/i.test(text.slice(term.index, term.index + 80))) return null;
  return Number(term[1]) * (/year/i.test(term[2]) ? 12 : 1);
}
