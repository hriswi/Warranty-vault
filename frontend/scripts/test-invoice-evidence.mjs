import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { productPages, assessInvoice } from '../src/lib/invoiceEvidence.js';
import { getWarrantyTimeline } from '../src/lib/warrantyStatus.js';
import { mapInvoiceToFormFields } from '../src/lib/invoiceFormMapper.js';

const downloads = path.join(os.homedir(),'Downloads');
const cases = [
  ['../invoice1.pdf',{pageNumber:1,productName:'Noise Buds Play Truly Wireless Earbuds',brand:'Noise',seller:'Clicktech Retail Private Limuted',purchaseDate:'2026-09-03',invoiceNumber:'PAX1-773785',orderNumber:'408-5569467-6337940',purchasePrice:1199,asin:'B0FZ9Y2RJN',serialNumber:null,warrantyMonths:null},null],
  [path.join(downloads,'OD332501644503938100 (2).pdf'),{pageNumber:2,productName:'Samsung Galaxy A14 5G',seller:'CIGFIL Limited',purchaseDate:'2024-10-06',invoiceNumber:'FAJC2L2500186660',orderNumber:'OD332501644503938100',purchasePrice:10749,serialNumber:'354889666146616',warrantyMonths:12,accessoryWarrantyMonths:6},'2025-10-06'],
  [path.join(downloads,'invoice.pdf'),{pageNumber:1,productName:'Redmi Note 9',seller:'Darshita Aashiyana Pvt Ltd',purchaseDate:'2020-10-17',invoiceNumber:'IN-BLR5-372816',orderNumber:'403-6940556-4843548',purchasePrice:10999,asin:'B086977TR6',serialNumber:null,warrantyMonths:null},null],
  ['../dummy_warranty_invoice_test (1).pdf',{pageNumber:1,productName:'Lenovo ThinkPad E14 Gen 5',purchaseDate:'2026-08-10',invoiceNumber:'TH-INV-2026-0810-0042',purchasePrice:84960,subtotal:72000,tax:12960,serialNumber:'PF4X9K7L2M',warrantyMonths:24},'2028-08-10'],
];
for (const [index,[fallback,expected,expiry]] of cases.entries()) {
  const task=getDocument({data:new Uint8Array(fs.readFileSync(process.argv[index+2] || fallback))});
  try {
    const doc=await task.promise;
    const pages=[];
    for(let i=1;i<=doc.numPages;i++){
      const page=await doc.getPage(i);
      pages.push((await page.getTextContent()).items.map(x=>x.str+(x.hasEOL?'\n':' ')).join(''));
    }
    const candidates=productPages(pages);
    assert.equal(candidates.length,1);
    const [inv]=candidates;
    for (const [key,value] of Object.entries(expected)) assert.equal(inv[key],value,key);
    assert.equal(getWarrantyTimeline(inv).expiryIso,expiry);
    const report=assessInvoice(inv);
    assert.equal(report.status,index===3?'Needs checking':'Looks okay');
    if(index===3) assert.ok(report.issues.includes('This document is marked as a synthetic test invoice and is not valid proof of purchase.'));
    if(!expiry) assert.ok(report.notes.includes('Warranty not specified in invoice.'));
    const form=mapInvoiceToFormFields(inv);
    assert.equal(form.productName,expected.productName);
    assert.equal(form.serialNumber || null,expected.serialNumber);
    console.log('PASS',expected.productName);
  } finally { await task.destroy(); }
}
const feeOnly = 'Marketplace Fee Invoice\nInvoice Number: FEE-42\n1 Marketplace Fees\nTOTAL: INR 5';
assert.deepEqual(productPages([feeOnly]), []);
const twoProducts = 'Tax Invoice\nInvoice Number: RET-100\n1 Printer INR 2000\n2 Router INR 1000\nTOTAL: INR 3000';
assert.deepEqual(productPages([twoProducts]).map(p=>p.purchasePrice),[2000,1000]);
assert.equal(productPages([twoProducts,feeOnly]).length,2);
const bad = productPages(['Invoice Number: RET-1\nInvoice Date: 31-02-2020\nIMEI: 1234\nSerial Number: B086977TR6\nASIN: B086977TR6\nSubtotal: INR 50\nTax: INR 9\nGrand Total: INR 80'])[0];
assert.equal(bad.serialNumber,null);
assert.equal(bad.purchaseDate,null);
assert.equal(assessInvoice(bad).status,'Needs checking');
assert.ok(assessInvoice(bad).issues.some(message=>message.includes('totals')));
console.log('PASS fee-only, item selection, identifier collisions, malformed IMEI, invalid date and conflicting totals');
