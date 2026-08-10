/** Browser-only invoice storage. Firestore retains product metadata only. */
const DB_NAME = 'warranty-vault-files';
const STORE_NAME = 'invoices';
const DB_VERSION = 1;

function openDatabase() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('Browser file storage is unavailable.'));
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Unable to open browser file storage.'));
  });
}

function requestResult(request, message) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(message));
  });
}

const invoiceId = (userId, productId) => `${userId}:${productId}`;

export async function saveInvoice({ userId, productId, file }) {
  if (!userId || !productId || !file) throw new Error('A user, product, and invoice file are required.');
  const db = await openDatabase();
  try {
    const record = { id: invoiceId(userId, productId), userId, productId, file, filename: file.name, mimeType: file.type, size: file.size, createdAt: new Date().toISOString() };
    await requestResult(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record), 'Unable to save the invoice on this device.');
    return record;
  } catch (error) {
    if (error?.name === 'QuotaExceededError') throw new Error('Browser file storage is full. Free space and try again.');
    throw error;
  } finally { db.close(); }
}

export async function getInvoice(userId, productId) {
  if (!userId || !productId) return null;
  const db = await openDatabase();
  try { return await requestResult(db.transaction(STORE_NAME).objectStore(STORE_NAME).get(invoiceId(userId, productId)), 'Unable to read the local invoice.'); }
  finally { db.close(); }
}

export async function deleteInvoice(userId, productId) {
  if (!userId || !productId) return;
  const db = await openDatabase();
  try { await requestResult(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(invoiceId(userId, productId)), 'Unable to remove the local invoice.'); }
  finally { db.close(); }
}

export async function clearInvoices(userId) {
  if (!userId) return;
  const db = await openDatabase();
  try {
    const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
    const records = await requestResult(store.getAll(), 'Unable to read local invoices.');
    await Promise.all(records.filter((record) => record.userId === userId).map((record) => requestResult(store.delete(record.id), 'Unable to clear local invoices.')));
  } finally { db.close(); }
}
