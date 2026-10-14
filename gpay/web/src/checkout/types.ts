export interface PublicShop {
  id: number;
  name: string;
  legalName: string;
  inn: string;
  site: string;
  color: string;
  methods: MethodType[];
  active: boolean;
}

export type MethodType = 'bank_card' | 'sbp' | 'installments' | 'crypto';

export interface PublicPayment {
  id: string;
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled';
  amount: number;
  currency: string;
  refunded: number;
  description: string;
  items: { name: string; quantity: number; price: number }[] | null;
  customerEmail: string | null;
  createdAt: number;
  expiresAt: number;
  capturedAt: number | null;
  returnUrl: string | null;
  attemptsLeft: number;
  action: { type: 'processing'; until: number } | { type: 'bank_confirm'; until: number; bank: string } | null;
  /** Bobobank page that pays this order by SBP (encoded in the QR code), when the bank is connected. */
  sbpBankUrl: string | null;
  funding: 'bank' | 'test';
  method: {
    type: MethodType;
    title: string;
    crypto?: { asset: 'BTC' | 'USDT'; network: string; address: string; amount: string; tx_hash: string | null; confirmations?: number };
    plan?: { parts: number; period_days: number; part_amount: { value: string; currency: string } };
    sbp?: { operationId: string };
  } | null;
  methodType: MethodType | null;
  cancellation: { party: string; reason: string } | null;
  lastDecline: { reason: string; message: string } | null;
  receipts: { id: string; type: string; createdAt: number }[];
}

export interface CheckoutData {
  payment: PublicPayment;
  shop: PublicShop;
  rates: { USD: number; EUR: number; BTC: number; USDT: number };
}

export type PayResult =
  | { result: 'succeeded' | 'waiting_for_capture' }
  | { result: 'processing'; until: number }
  | { result: 'declined'; reason: string; message: string; canceled: boolean };

/** Messages to the parent window when the page runs inside the gpay.js widget. */
export function notifyParent(type: 'success' | 'fail' | 'close' | 'pending', paymentId: string, extra: Record<string, unknown> = {}) {
  if (window.parent !== window) window.parent.postMessage({ source: 'gpay', type, paymentId, ...extra }, '*');
}
