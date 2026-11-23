// One-time copy for a signed-in account. The running app never accesses Firestore.
const token = process.env.FIREBASE_ID_TOKEN;
if (!token) throw new Error('Set FIREBASE_ID_TOKEN to a current ID token for the account being migrated.');
const { sub, aud } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
if (aud !== 'warranty-intelligence-system') throw new Error('Unexpected Firebase project.');
const source = 'https://firestore.googleapis.com/v1/projects/warranty-intelligence-system/databases/(default)/documents';
const destination = 'https://warranty-vault-ai.warranty-vault-cloudflare-ai.workers.dev/api/vault/';
const headers = { Authorization: 'Bearer ' + token };
function decode(value) {
  if ('mapValue' in value) return fields(value.mapValue.fields || {});
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('nullValue' in value) return null;
  return Object.values(value)[0];
}
function fields(object) {
  return Object.fromEntries(Object.entries(object).map(([k,v]) => [k,decode(v)]));
}
const query = { structuredQuery: { from: [{ collectionId: 'products' }], where: {
  fieldFilter: { field: { fieldPath: 'userId' }, op: 'EQUAL', value: { stringValue: sub } }
} } };
const records = await fetch(source + ':runQuery', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(query) });
if (!records.ok) throw new Error('Could not read source records: ' + records.status);
async function attachment(id, key) {
  const response = await fetch(source + '/products/' + encodeURIComponent(id) + '/invoices/' + encodeURIComponent(key), { headers });
  if (!response.ok) throw new Error('Could not read legacy attachment: ' + response.status);
  const data = fields((await response.json()).fields);
  return new File([Buffer.from(data.content, 'base64')], data.name, { type: data.mime });
}
async function write(action, params, record, file) {
  const form = new FormData();
  form.set('fields', JSON.stringify(record));
  if (file) form.set('file', file);
  const response = await fetch(destination + action + '?' + new URLSearchParams(params), { method: 'POST', headers, body: form });
  if (!response.ok && !(action === 'create' && response.status === 409)) throw new Error('Copy failed: ' + response.status);
}
let count = 0;
for (const { document } of await records.json()) {
  if (!document) continue;
  const id = document.name.split('/').pop();
  const data = fields(document.fields);
  const repairs = data.repairHistory || [];
  await write('create', { id }, { ...data, repairHistory: repairs.filter(r => !r.fileKey) }, data.invoiceInCloud ? await attachment(id, 'purchase') : null);
  for (const repair of repairs.filter(r => r.fileKey)) {
    await write('repair', { id, key: repair.fileKey }, repair, await attachment(id, repair.fileKey));
  }
  count++;
}
console.log('Processed ' + count + ' legacy products. Source records were kept.');

