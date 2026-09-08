// verify-save-path.mjs — mimics UploadPage.handleSave with the REAL pipeline
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const ROOT = 'C:/Autonomous-Warranty-Intelligence-System';
const OUT = 'C:/Users/Prasanth/AppData/Local/Temp/opencode/save-path.txt';
const lines = [];
const log = (m) => lines.push(m);

const { processInvoiceText } = await import(pathToFileURL(`${ROOT}/frontend/src/lib/engine/ai-engine/warrantyIntelligencePipeline.js`).href);
const { computeExtractionDetails } = await import(pathToFileURL(`${ROOT}/frontend/src/lib/extractionConfidence.js`).href);
const { computeProductRisk } = await import(pathToFileURL(`${ROOT}/frontend/src/lib/engine/ai-engine/productRiskEngine.js`).href);

const OCR_TEXT = `TECHHUB ELECTRONICS
TAX INVOICE
Invoice No: TH-INV-2026-0810-0042
Invoice Date: 10-08-2026
Seller: TechHub Electronics Pvt. Ltd.
GSTIN: 29AABCT1234K1Z5
Bill To: Prasanth V
Bengaluru, Karnataka, India
Product: Laptop Computer
Brand: Lenovo
Model: ThinkPad E14 Gen 5
Qty: 1  Unit Price: Rs. 72,000  Total: Rs. 72,000
Serial Number: PF4X9K7L2M
Purchase Date: 10-08-2026
Warranty: 24 Months`;

log('=== 1. pipeline (fraud-first order) ===');
const pipelineResult = await processInvoiceText(OCR_TEXT, { referenceDate: new Date('2026-08-13') });
log('stageStatuses: ' + JSON.stringify(pipelineResult.stageStatuses));
log('pipeline risk: score=' + pipelineResult.risk.riskScore + ' level=' + pipelineResult.risk.riskLevel + ' conf=' + pipelineResult.risk.riskConfidence);
log('riskFactors: ' + pipelineResult.risk.riskFactors.map((f) => `${f.name}=${f.contribution}`).join(' | '));
log('riskWarnings: ' + JSON.stringify(pipelineResult.risk.riskWarnings));
log('fraud.warningLevel=' + pipelineResult.fraud.warningLevel + ' signals=' + pipelineResult.fraud.signals.length);

log('\n=== 2. UploadPage save path (extractionDetails + risk recompute) ===');
const aiInvoice = {
  productName: 'Lenovo ThinkPad E14 Gen 5', brand: 'Lenovo', category: 'Laptop',
  purchaseDate: '2026-08-10', warrantyMonths: 24, invoiceNumber: 'TH-INV-2026-0810-0042',
  serialNumber: 'PF4X9K7L2M', seller: 'TechHub Electronics Pvt. Ltd.', purchasePrice: 84960, currency: 'INR',
};
const form = {
  productName: 'Lenovo ThinkPad E14 Gen 5', brand: 'Lenovo', category: 'Laptop',
  purchaseDate: '2026-08-10', warrantyMonths: 24, invoiceNumber: 'TH-INV-2026-0810-0042',
  serialNumber: 'PF4X9K7L2M', seller: 'TechHub Electronics Pvt. Ltd.', price: '84960',
};
const parsedInvoice = pipelineResult._raw.parsedInvoice;
const extractionDetails = computeExtractionDetails({
  form,
  aiInvoice,
  parsedInvoice,
  parserFieldConf: parsedInvoice.fieldConfidence || {},
  userEditedFields: new Set(),
});
log('overallConfidence=' + extractionDetails.overallConfidence + ' sources=' + JSON.stringify(extractionDetails.sourcesUsed));
log('perField productName=' + JSON.stringify(extractionDetails.perField.productName));
log('perField price=' + JSON.stringify(extractionDetails.perField.price));
log('missing=' + JSON.stringify(extractionDetails.missingFields) + ' reviewNeeded=' + extractionDetails.needsManualReview);

const riskInput = parsedInvoice;
const finalRisk = computeProductRisk(
  { ...riskInput, overallConfidence: extractionDetails.overallConfidence },
  new Date('2026-08-13'),
  { fraudReport: pipelineResult.fraud }
);
log('\n=== 3. persisted risk document ===');
log('riskScore=' + finalRisk.riskScore + ' level=' + finalRisk.riskLevel + ' label=' + finalRisk.riskLevelLabel + ' conf=' + finalRisk.riskConfidence);
log('factors=' + finalRisk.riskFactors.map((f) => `${f.name}=${f.contribution}`).join(', '));
log('evidence=' + finalRisk.riskEvidence.length + ' entries, warnings=' + finalRisk.riskWarnings.length);
log('recommendation=' + finalRisk.recommendation);
log('riskLastCalculatedAt=' + finalRisk.riskLastCalculatedAt);

writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log('written', lines.length, 'lines');
