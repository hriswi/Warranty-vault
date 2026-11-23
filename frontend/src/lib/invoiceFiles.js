import { auth } from './firebase.js';
import { hostedDefault } from './api.js';
import { validateFile } from './fileValidation.js';
import { deleteInvoice } from './localFileStore.js';
import { useStore } from '../store/store.js';

const base = (import.meta.env.VITE_VAULT_BASE_URL || hostedDefault).replace(/\/+$/, '');
export const vaultChanged = 'warranty-records-changed';

async function request(action, params = {}, form, signal) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to open your warranty records.');
  const response = await fetch(base + '/api/vault/' + action + '?' + new URLSearchParams(params), {
    method: 'POST', headers: { Authorization: 'Bearer ' + await user.getIdToken() }, body: form, signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || body.error?.message || (typeof body.error === 'string' && body.error) || 'Warranty storage is unavailable.');
  }
  if (user.uid !== auth.currentUser?.uid) throw new Error('Sign-in changed. Open your records again.');
  return response;
}

export async function listProducts(signal) {
  return (await request('list', {}, undefined, signal)).json();
}

async function save(action, params, fields, file) {
  const form = new FormData();
  form.set('fields', JSON.stringify(fields));
  if (file) {
    const result = await validateFile(file);
    if (!result.valid) throw new Error(result.error);
    form.set('file', file);
  }
  const response = await request(action, params, form);
  const product = await response.json();
  const state = useStore.getState();
  state.setProducts([product, ...state.products.filter(p => p.id !== product.id)]);
  window.dispatchEvent(new Event(vaultChanged));
  return product.id;
}

export function saveProduct(existingId, fields, file) {
  return save(existingId ? 'edit' : 'create', { id: existingId || crypto.randomUUID() }, fields, file);
}

export async function readFile(id, key) {
  const response = await request('download', { id, key });
  const blob = await response.blob();
  return new File([blob], decodeURIComponent(response.headers.get('X-Filename') || 'invoice'), { type: blob.type });
}

export function addRepair(id, entry, file) {
  return save('repair', { id, key: crypto.randomUUID() }, entry, file);
}

export async function removeProduct(product) {
  await request('delete', { id: product.id });
  useStore.getState().deleteProduct(product.id);
  window.dispatchEvent(new Event(vaultChanged));
  await deleteInvoice(auth.currentUser?.uid, product.id).catch(() => {});
}
