/**
 * Client-side encryption for the shared password vault (Web Crypto, AES-256-GCM).
 *
 * A random data-encryption key (DEK) encrypts every item. The DEK is stored on the server
 * only in wrapped form: once under a key derived from the master password and once under
 * a key derived from the printable recovery code. Changing the master password re-wraps
 * the same DEK, so stored items never need re-encryption.
 */
import type { VaultSecret } from './types';

export const PBKDF2_ITERATIONS = 600_000;

export interface Wrapped {
  iv: string;
  ct: string;
}

export interface VaultMeta {
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  masterSalt: string;
  masterWrapped: Wrapped;
  recoverySalt: string;
  recoveryWrapped: Wrapped;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(n: number) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function deriveKek(secret: string, saltB64: string, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function wrapRaw(kek: CryptoKey, raw: Uint8Array<ArrayBuffer>): Promise<Wrapped> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw);
  return { iv: toB64(iv), ct: toB64(ct) };
}

async function unwrapRaw(kek: CryptoKey, w: Wrapped): Promise<Uint8Array<ArrayBuffer>> {
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(w.iv) }, kek, fromB64(w.ct));
  return new Uint8Array(raw);
}

function importDek(raw: Uint8Array<ArrayBuffer>) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 32 characters from a 32-symbol alphabet = 160 bits, shown as 8 groups of 4. */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(32);
  const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b & 31]);
  return chars.join('').match(/.{4}/g)!.join('-');
}

export function normalizeRecoveryCode(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function createVault(masterPassword: string, iterations = PBKDF2_ITERATIONS) {
  const dekRaw = randomBytes(32);
  const recoveryCode = generateRecoveryCode();
  const meta = await buildMeta(dekRaw, masterPassword, recoveryCode, iterations);
  return { meta, recoveryCode, dek: await importDek(dekRaw), dekRaw };
}

async function buildMeta(dekRaw: Uint8Array<ArrayBuffer>, masterPassword: string, recoveryCode: string, iterations: number): Promise<VaultMeta> {
  const masterSalt = toB64(randomBytes(16));
  const recoverySalt = toB64(randomBytes(16));
  const [mk, rk] = await Promise.all([
    deriveKek(masterPassword, masterSalt, iterations),
    deriveKek(normalizeRecoveryCode(recoveryCode), recoverySalt, iterations),
  ]);
  return {
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations,
    masterSalt,
    masterWrapped: await wrapRaw(mk, dekRaw),
    recoverySalt,
    recoveryWrapped: await wrapRaw(rk, dekRaw),
  };
}

/** Throws if the password is wrong (AES-GCM authentication fails). */
export async function unlockWithMaster(meta: VaultMeta, masterPassword: string) {
  const kek = await deriveKek(masterPassword, meta.masterSalt, meta.iterations);
  const dekRaw = await unwrapRaw(kek, meta.masterWrapped);
  return { dek: await importDek(dekRaw), dekRaw };
}

export async function unlockWithRecovery(meta: VaultMeta, recoveryCode: string) {
  const kek = await deriveKek(normalizeRecoveryCode(recoveryCode), meta.recoverySalt, meta.iterations);
  const dekRaw = await unwrapRaw(kek, meta.recoveryWrapped);
  return { dek: await importDek(dekRaw), dekRaw };
}

/** Re-wraps the existing DEK with a new master password and a fresh recovery code. */
export async function rekey(dekRaw: Uint8Array<ArrayBuffer>, newMasterPassword: string, iterations = PBKDF2_ITERATIONS) {
  const recoveryCode = generateRecoveryCode();
  return { meta: await buildMeta(dekRaw, newMasterPassword, recoveryCode, iterations), recoveryCode };
}

export async function encryptSecret(dek: CryptoKey, secret: VaultSecret): Promise<{ ct: string; iv: string }> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, enc.encode(JSON.stringify(secret)));
  return { ct: toB64(ct), iv: toB64(iv) };
}

export async function decryptSecret(dek: CryptoKey, item: { ct: string; iv: string }): Promise<VaultSecret> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(item.iv) }, dek, fromB64(item.ct));
  const obj = JSON.parse(dec.decode(plain));
  return { site: '', url: '', login: '', password: '', notes: '', ...obj };
}
