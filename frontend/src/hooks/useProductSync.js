/**
 * useProductSync.js — Subscribes to the user's products in Firestore
 * and keeps the Zustand store in sync in real time.
 *
 * Resilient to missing composite indexes during deployment: falls back
 * to client-side sorting if the server-side orderBy query fails.
 */
import { useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useAuth } from './useAuth.jsx';
import { useStore } from '../store/store.js';

function normalizeDoc(d) {
  return {
    id: d.id,
    ...d.data(),
    createdAt: d.data().createdAt?.toDate?.().toISOString() || new Date().toISOString(),
  };
}

function sortByCreatedAtDesc(products) {
  return products.slice().sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
}

function isMissingIndexError(err) {
  if (!err) return false;
  const code = err.code || '';
  const msg = (err.message || '').toLowerCase();
  return code === 'failed-precondition'
    || msg.includes('index')
    || msg.includes('requires an index')
    || msg.includes('firestore');
}

export function useProductSync() {
  const { user } = useAuth();
  const { setProducts, setAgentMemory } = useStore();

  useEffect(() => {
    if (!user) { setProducts([]); setAgentMemory(null); return; }

    let unsub = null;
    let destroyed = false;

    const hydrateWithFallback = async () => {
      try {
        const fallbackQ = query(
          collection(db, 'products'),
          where('userId', '==', user.uid)
        );
        const snap = await getDocs(fallbackQ);
        if (destroyed) return;
        const products = sortByCreatedAtDesc(snap.docs.map(normalizeDoc));
        setProducts(products);
      } catch (innerErr) {
        console.error('[ProductSync] fallback hydration also failed:', innerErr);
      }
    };

    const q = query(
      collection(db, 'products'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    unsub = onSnapshot(q, (snap) => {
      const products = snap.docs.map(normalizeDoc);
      setProducts(products);
    }, async (err) => {
      console.error('[ProductSync] ordered query error (expected if index is propagating):', err);
      if (isMissingIndexError(err)) {
        hydrateWithFallback();
        return;
      }
      hydrateWithFallback();
    });

    return () => {
      destroyed = true;
      if (unsub) unsub();
    };
  }, [user?.uid]);
}

export default useProductSync;
