import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { mapInvoiceToFormFields } from '../src/lib/invoiceFormMapper.js';
import { getWarrantyTimeline } from '../src/lib/warrantyStatus.js';
const task = getDocument({data:new Uint8Array(fs.readFileSync(process.argv[2])),useSystemFonts:true});
const doc = await task.promise;
let text = '';
try {
  for (let n=1; n<=doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    text += content.items.map(i=>i.str+(i.hasEOL?'\n':' ')).join('')+'\n';
  }
} finally { await task.destroy(); }
const options={rawText:text,allowedCategories:['Laptop','Smartphone']};
const wrong={category:'Laptop', seller:':',serialNumber:'B086977TR6',warrantyMonths:3};
const fields=mapInvoiceToFormFields(wrong,options);
assert.deepEqual(fields,{productName:'Redmi Note 9 (Pebble Grey, 4GB RAM, 64GB Storage)',brand:'Redmi',model:'Redmi Note 9',category:'Smartphone',purchaseDate:'2020-10-17',invoiceNumber:'IN-BLR5-372816',orderNumber:'403-6940556-4843548',seller:'Darshita Aashiyana Pvt Ltd',price:'10999',currency:'INR'});
assert.equal(mapInvoiceToFormFields(wrong,{...options,userEditedFields:new Set(['seller'])}).seller,undefined);
assert.equal(getWarrantyTimeline(fields).expiry,null);
assert.equal(getWarrantyTimeline({...fields,warrantyMonths:'12'}).expiryIso,'2021-10-17');
console.log('Amazon PDF: verified all expected fields, omissions, correction protection, expiry.');

