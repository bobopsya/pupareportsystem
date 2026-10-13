import { getSetting, setSetting, type DB } from '../db.js';
import { safeJson } from '../util.js';

export const METHODS = ['bank_card', 'sbp', 'installments', 'crypto'] as const;
export type MethodType = (typeof METHODS)[number];

export const METHOD_TITLE: Record<MethodType, string> = {
  bank_card: 'Банковская карта',
  sbp: 'СБП',
  installments: 'Оплата частями',
  crypto: 'Криптовалюта',
};

/** Percent of the payment kept by GPAY. */
export type Fees = Record<MethodType, number>;
export const DEFAULT_FEES: Fees = { bank_card: 2.8, sbp: 0.7, installments: 4.9, crypto: 1.5 };

export const getGlobalFees = (db: DB): Fees => ({ ...DEFAULT_FEES, ...getSetting<Partial<Fees>>(db, 'fees', {}) });
export const setGlobalFees = (db: DB, fees: Fees) => setSetting(db, 'fees', fees);

export function shopFees(db: DB, shopFeesJson: string): Fees {
  return { ...getGlobalFees(db), ...safeJson<Partial<Fees>>(shopFeesJson, {}) };
}

export const feeFor = (amount: number, pct: number) => Math.round((amount * pct) / 100);
