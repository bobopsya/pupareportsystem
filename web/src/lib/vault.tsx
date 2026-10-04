import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import type { VaultItem, VaultSecret } from './types';
import { createVault, decryptSecret, encryptSecret, rekey, unlockWithMaster, unlockWithRecovery, type VaultMeta } from './vaultCrypto';

const AUTO_LOCK_MS = 5 * 60 * 1000;

interface VaultState {
  metaLoading: boolean;
  initialized: boolean;
  unlocked: boolean;
  /** Recovery code shown right after the vault was created, until the user confirms saving it. */
  pendingRecovery: string | null;
  ackRecovery: () => void;
  init: (master: string) => Promise<void>;
  unlock: (master: string) => Promise<void>;
  unlockRecovery: (code: string) => Promise<void>;
  /** Sets a new master password; returns the new recovery code. */
  changeMaster: (newMaster: string) => Promise<string>;
  lock: () => void;
  seal: (secret: VaultSecret) => Promise<{ ct: string; iv: string }>;
  open: (item: Pick<VaultItem, 'ct' | 'iv'>) => Promise<VaultSecret>;
  touch: () => void;
}

const Ctx = createContext<VaultState | null>(null);

export function VaultProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const metaQ = useQuery({ queryKey: ['vault-meta'], queryFn: () => api<{ initialized: boolean; meta: VaultMeta | null }>('/vault/meta') });
  const [key, setKey] = useState<{ dek: CryptoKey; dekRaw: Uint8Array<ArrayBuffer> } | null>(null);
  const lastUse = useRef(Date.now());
  const [pendingRecovery, setPendingRecovery] = useState<string | null>(null);

  const lock = useCallback(() => {
    setKey((k) => {
      k?.dekRaw.fill(0);
      return null;
    });
    qc.removeQueries({ queryKey: ['vault-plain'] });
  }, [qc]);

  const touch = useCallback(() => (lastUse.current = Date.now()), []);

  useEffect(() => {
    if (!key) return;
    const t = setInterval(() => Date.now() - lastUse.current > AUTO_LOCK_MS && lock(), 5000);
    const bump = () => touch();
    window.addEventListener('mousedown', bump);
    window.addEventListener('keydown', bump);
    return () => {
      clearInterval(t);
      window.removeEventListener('mousedown', bump);
      window.removeEventListener('keydown', bump);
    };
  }, [key, lock, touch]);

  // Lock on unmount (logout).
  useEffect(() => () => lock(), [lock]);

  const meta = metaQ.data?.meta ?? null;

  const value: VaultState = {
    metaLoading: metaQ.isLoading,
    initialized: !!metaQ.data?.initialized,
    unlocked: !!key,
    pendingRecovery,
    ackRecovery: () => setPendingRecovery(null),
    async init(master) {
      const v = await createVault(master);
      await api('/vault/init', { body: v.meta });
      setPendingRecovery(v.recoveryCode);
      await qc.invalidateQueries({ queryKey: ['vault-meta'] });
      touch();
      setKey({ dek: v.dek, dekRaw: v.dekRaw });
    },
    async unlock(master) {
      if (!meta) throw new Error('Хранилище не создано');
      try {
        const k = await unlockWithMaster(meta, master);
        touch();
        setKey(k);
      } catch {
        throw new Error('Неверный мастер-ключ');
      }
    },
    async unlockRecovery(code) {
      if (!meta) throw new Error('Хранилище не создано');
      try {
        const k = await unlockWithRecovery(meta, code);
        touch();
        setKey(k);
      } catch {
        throw new Error('Неверный код восстановления');
      }
    },
    async changeMaster(newMaster) {
      if (!key) throw new Error('Сначала разблокируйте хранилище');
      const r = await rekey(key.dekRaw, newMaster);
      await api('/vault/meta', { method: 'PUT', body: r.meta });
      await qc.invalidateQueries({ queryKey: ['vault-meta'] });
      return r.recoveryCode;
    },
    lock,
    async seal(secret) {
      if (!key) throw new Error('Хранилище заблокировано');
      touch();
      return encryptSecret(key.dek, secret);
    },
    async open(item) {
      if (!key) throw new Error('Хранилище заблокировано');
      return decryptSecret(key.dek, item);
    },
    touch,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVault() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useVault outside VaultProvider');
  return v;
}

export interface PlainItem {
  item: VaultItem;
  secret: VaultSecret | null;
}

/** Vault items decrypted in memory (only while unlocked). */
export function usePlainVault(filters: Record<string, string> = {}) {
  const vault = useVault();
  const qs = new URLSearchParams(filters).toString();
  const itemsQ = useQuery({ queryKey: ['vault-items', filters], queryFn: () => api<VaultItem[]>(`/vault-items${qs ? `?${qs}` : ''}`) });
  const plainQ = useQuery({
    queryKey: ['vault-plain', filters, itemsQ.dataUpdatedAt],
    enabled: vault.unlocked && !!itemsQ.data,
    gcTime: 0,
    queryFn: async (): Promise<PlainItem[]> =>
      Promise.all(itemsQ.data!.map(async (item) => ({ item, secret: await vault.open(item).catch(() => null) }))),
  });
  return { items: itemsQ.data, plain: vault.unlocked ? plainQ.data : undefined, loading: itemsQ.isLoading || (vault.unlocked && plainQ.isLoading) };
}
