import { parseInvoice } from './engine/parsers/invoiceParser.js';
import { readAmazonInvoice } from './amazonInvoice.js';

const money = /(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/gi;
const amounts = line => Array.from((line || '').matchAll(money), m => Number(m[1].replaceAll(',', '')));

export function cleanTitle(title = '') {
  return title.replace(/^\s*\d+[.)]?\s+(?=[A-Za-z])/, '').replace(/\bnewly launch(?:ed)?\s+/ig, '')
    .split(/\s+(?:with\s+\d+\s*(?:h|hours)|[-–]\s*\d+\s+months|HSN\b)|\s*\([^)]*(?:GB|Grey|Pink|Red|Black)|\s*\|\s*B0/i)[0]
    .replace(/\s+(?:INR|Rs\.|₹)\s*[\d,]+(?:\.\d{2})?.*$/i,'').replace(/^samsung\b/i, 'Samsung').trim();
}

function isoDate(value) {
  if (!value) return null;
  const parts = value.split(/[./-]/);
  const iso = (parts[0].length === 4 ? parts : parts.reverse()).join('-');
  const d = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(+d) && d.toISOString().startsWith(iso) ? iso : null;
}

export function readPage(text, pageNumber, candidateTitle) {
  const base = parseInvoice(text);
  const amazon = readAmazonInvoice(text);
  const flat = text.replace(/\s+/g, ' ');
  const match = re => text.match(re)?.[1]?.trim();
  const lines = text.split(/\r?\n/);
  const item = candidateTitle || match(/^\s*\d+\s+([A-Za-z][^\n]+)/m);
  const modelRow = text.match(/^.+?[ \t]{2,}([A-Za-z][\w-]+)[ \t]{2,}([^\n]+?)[ \t]{2,}\d+[ \t]{2,}(?:Rs\.|₹)/m);
  const productName = cleanTitle(candidateTitle || (amazon && item) || (modelRow && modelRow[1]+' '+modelRow[2]) || match(/^\s*([A-Z][A-Za-z]+ Galaxy [^\n]+)/im) || base.productName || '');
  const dateToken = match(/(?:Invoice Date|Purchase Date)\s*:\s*(\d{2,4}[./-]\d{2}[./-]\d{2,4})/i) || match(/(\d{2}-\d{2}-\d{4})\s+Invoice Date/i);
  const invoiceNumber = match(/\bInvoice\s+(?:Number|No\.?)\s*[:#]\s*([A-Z0-9][\w/-]*\d)\b/i) || base.invoiceNumber;
  const orderNumber = amazon?.orderNumber || match(/\b(OD\d{10,})\b/i) || base.orderNumber;
  const asin = match(/\b(B0[A-Z0-9]{8})\b/);
  const imei = flat.match(/\bIMEI(?:\s*\/\s*Serial No\.?)?\s*:\s*\]?\s*((?:\d[\s-]*){14}\d)(?!\d)/i)?.[1]?.replace(/\D/g,'');
  const serial = match(/\bSerial (?:Number|No\.?)\s*:\s*([A-Z0-9][A-Z0-9-]{3,29})\b/i);
  const malformedImei = !imei && /\bIMEI(?:\s*\/\s*Serial No\.?)?\s*:\s*\]?\s*[A-Z0-9]/i.test(flat);
  const otherIds = [...text.matchAll(/\b(?:ASIN|FSN|GSTIN|HSN(?:\/SAC)?)\s*[:#]\s*([A-Z0-9-]+)/gi)].map(m => m[1]);
  const reserved = new Set([asin, invoiceNumber, orderNumber, ...otherIds].filter(Boolean).map(id=>id.toUpperCase()));
  const deviceId = imei || serial;
  const serialNumber = deviceId && !reserved.has(deviceId.toUpperCase()) ? deviceId : null;
  const terms = [...flat.matchAll(/(\d+)\s*(years?|months?)\s+(?:manufacturer(?:'s)?\s+)?warranty(?:\s+for\s+(?:the\s+)?(in[- ]box accessories|accessories|device|handset|phone|product))?/gi)];
  const months = m => m ? Number(m[1]) * (/year/i.test(m[2]) ? 12 : 1) : null;
  const deviceTerms = terms.filter(m => !/accessories/i.test(m[3] || ''));
  const durations = [...new Set(deviceTerms.map(months))];
  const warrantyMonths = terms.length ? (durations.length === 1 ? durations[0] : null) : /\bwarranty\s*:\s*\d+\s*(?:months?|years?)\b/i.test(flat) ? base.warrantyMonths : null;
  const totalLines = lines.filter(l => /^\s*(?:grand total|total\s*:)/i.test(l));
  const totals = totalLines.map(l=>amounts(l).at(-1)).filter(Number.isFinite);
  const subtotal = amounts(lines.find(l=>/^\s*subtotal:/i.test(l)))[0];
  const tax = amounts(lines.find(l=>/^\s*(?:GST|Tax)\b.*:/i.test(l)))[0];
  const purchasePrice = totals.at(-1) ?? base.purchasePrice;
  return {productName, brand: amazon?.brand || modelRow?.[1] || (productName.match(/^(Noise|Samsung|Redmi)\b/i)?.[1]) || base.brand,
    invoiceOrderConflict: Boolean(invoiceNumber && invoiceNumber === orderNumber),
    seller: match(/^\s*For ([^:\n]+):/im) || match(/(?:Sold By|Seller)\s*:\s*([^\r\n,]+)/i) || base.seller,
    invoiceNumber, orderNumber, asin, serialNumber, malformedImei, category:base.category, variant:amazon?.productName?.match(/\((.+)\)/)?.[1] || null, purchaseDate: dateToken ? isoDate(dateToken) : base.purchaseDate,
    purchasePrice, currency: /₹|\bRs\.|\bINR\b/.test(text) ? 'INR' : base.currency,
    subtotal, tax, warrantyMonths, accessoryWarrantyMonths: months(terms.find(m=>/accessories/i.test(m[3] || ''))),
    warrantyStartDate: isoDate(match(/Warranty Start\s*:\s*([\d./-]+)/i)), warrantyConflict: durations.length>1,
    totalConflict: new Set(totals).size>1 || (Number.isFinite(subtotal) && Number.isFinite(tax) && Math.abs(subtotal+tax-purchasePrice)>.02),
    synthetic: /\bsynthetic test document\b|\bnot a real invoice\b/i.test(flat), pageNumber, evidence: text.slice(0,24000) };
}

function linesForItem(table, title) {
  return table.slice(table.indexOf(title)).split(/\n[ \t]*\d+[ \t]+[A-Za-z]/)[0];
}

export function productPages(pages) {
  return pages.flatMap((text,index) => {
    if (!text.trim()) return [];
    const flat = text.replace(/\s+/g,' ');
    const ancillaryInvoice = /\b(?:packaging|shipping|delivery|marketplace fee|service fee)[ -]+(?:fee[ -]+)?invoice\b/i.test(flat);
    const table = text.split(/^\s*TOTAL\s*:/im)[0].split(/Sl\.?\s*No\.?\s+Description/i).at(-1);
    const items = []; for (const m of table.matchAll(/^[ \t]*(\d+)[ \t]+([A-Za-z][^\n]+)/gm)) { if (Number(m[1]) === items.length + 1) items.push(m[2]); }
    const isFee = s => /^(?:(?:secure|shipping and)\s+)?(?:packaging|shipping|marketplace|service|delivery)\s+(?:fees?|charges?)\b/i.test(s);
    const products = items.filter(s=>!isFee(s));
    if (!products.length && (items.some(isFee) || ancillaryInvoice || /\bSAC:\s*\d+\s+(?:secure packaging|shipping|marketplace|service) fee/i.test(flat))) return [];
    if (products.length && (/amazon\.in/i.test(text) || products.length > 1)) {
      return products.map(title => {
        const invoice = readPage(text,index+1,title);
        if (products.length > 1) {
          // Page-wide amounts and identifiers cannot safely be assigned to one item.
          const row = linesForItem(table, title);
          invoice.purchasePrice = amounts(row).at(-1) ?? null;
          invoice.serialNumber = null;
          invoice.asin = row.match(/\bB0[A-Z0-9]{8}\b/)?.[0] || null;
          invoice.brand = null;
          invoice.warrantyMonths = null;
          invoice.accessoryWarrantyMonths = null;
          invoice.warrantyStartDate = null;
        }
        return invoice;
      });
    }
    if (pages.length > 1 && !/invoice|bill of supply|sale receipt|order (?:number|id)/i.test(text) && !products.length) return [];
    return [readPage(text,index+1)];
  });
}

export function assessInvoice(invoice) {
  if (!invoice) return null;
  const issues = [], notes = [], verified = [];
  if (invoice.synthetic) issues.push('This document is marked as a synthetic test invoice and is not valid proof of purchase.');
  for (const [key,label] of Object.entries({productName:'Product name',invoiceNumber:'Invoice number',seller:'Seller',purchaseDate:'Purchase date',purchasePrice:'Price'})) {
    if (invoice[key] != null && invoice[key] !== '' && (key !== 'purchasePrice' || Number(invoice[key]) > 0)) verified.push(label);
    else issues.push(label + ' could not be identified on the invoice.');
  }
  if (invoice.invoiceOrderConflict) issues.push('The invoice and order identifiers are identical. Check the printed labels.');
  if (invoice.malformedImei) issues.push('The printed IMEI could not be read as 15 digits. Check it against the device.');
  if (invoice.purchaseDate && !isoDate(invoice.purchaseDate)) issues.push('The purchase date is invalid.');
  if (!invoice.orderNumber) notes.push('Order number not identified.');
  if (invoice.totalConflict) issues.push('The invoice contains conflicting totals.');
  if (invoice.warrantyConflict) issues.push('The invoice gives conflicting device warranty durations.');
  if (invoice.warrantyMonths) verified.push('Device warranty (' + invoice.warrantyMonths + ' months)');
  if (invoice.serialNumber) verified.push('Serial number / IMEI');
  if (!invoice.warrantyMonths && !invoice.warrantyConflict) notes.push('Warranty not specified in invoice.');
  return {status:issues.length?'Needs checking':'Looks okay',issues,notes,verified,pageNumber:invoice.pageNumber};
}


