import { parseInvoice } from '../src/lib/engine/parsers/invoiceParser.js';

const text = `
TechHub Electronics Pvt. Ltd.
TAX INVOICE

Invoice Number: TH-INV-2026-0810-0042
Invoice Date: 10-08-2026
Purchase Date: 10-08-2026

Sold By: TechHub Electronics Pvt. Ltd.
Brand: Lenovo

Item Description: Lenovo ThinkPad E14 Gen 5
Serial No: PF4X9K7L2M

Qty: 1
Unit Price: Rs. 72,000.00
Total Amount: Rs. 72,000.00

Warranty: 24 Months Manufacturer Warranty
`;

const r = parseInvoice(text);
console.log(JSON.stringify(r, null, 2));
