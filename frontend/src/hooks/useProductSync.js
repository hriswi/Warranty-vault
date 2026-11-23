import { useEffect, useState } from 'react';
import { useAuth } from './useAuth.jsx';
import { useStore } from '../store/store.js';
import { listProducts, vaultChanged } from '../lib/invoiceFiles.js';

export function useProductSync() {
  const { user } = useAuth();
  const [error, setError] = useState('');
  useEffect(() => {
    const state = useStore.getState();
    state.setProducts([]);
    state.setAgentMemory(null);
    setError('');
    if (!user) return;
    let controller;
    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      try {
        const records = await listProducts(signal);
        if (!signal.aborted) {
          state.setProducts(records);
          setError('');
        }
      } catch {
        if (!signal.aborted) setError('Could not load warranty records.');
      }
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener(vaultChanged, refresh);
    return () => {
      controller.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener(vaultChanged, refresh);
    };
  }, [user?.uid]);
  return error;
}
