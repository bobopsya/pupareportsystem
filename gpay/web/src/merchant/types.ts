import type { MethodType } from '../checkout/types';

export interface Shop {
  id: number;
  gosBusinessId?: number | null;
  name: string;
  legalName: string;
  inn: string;
  taxSystem: string;
  site: string;
  color: string;
  status: 'active' | 'blocked';
  methods: MethodType[];
  fees: Record<MethodType, number>;
  returnUrl: string;
  defaultVat: string;
  mcc: number;
  payoutAccount: PayoutAccount | null;
  bankEnabled: boolean;
  kkt: { rn: string; fn: string; fd: number; shift: number };
  createdAt: number;
}

export interface PaymentRowT {
  id: string;
  shopId: number;
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled';
  amount: number;
  currency: string;
  fee: number;
  refunded: number;
  description: string;
  methodType: MethodType | null;
  methodTitle: string | null;
  cardBrand: string | null;
  email: string | null;
  source: string;
  cancellation: { reason: string; party?: string } | null;
  createdAt: number;
  capturedAt: number | null;
}

export interface Balance {
  currency: string;
  available: number;
  /** Bobobank money: can be paid out to the linked Bobobank account. */
  live: number;
  /** Game cards and simulated methods. */
  test: number;
  inTransit: number;
  held: number;
  paidOut: number;
}

export interface Analytics {
  days: number;
  from: number;
  kpi: { turnover: number; turnoverPrev: number; net: number; count: number; countPrev: number; avg: number; avgPrev: number; conversion: number | null; conversionPrev: number | null; refunds: number };
  series: { day: number; turnover: number; count: number; created: number; refunds: number }[];
  byMethod: Record<string, { count: number; turnover: number }>;
  byCurrency: Record<string, { count: number; amount: number }>;
  byStatus: Record<string, number>;
  declines: Record<string, number>;
  balances: Balance[];
  recent: PaymentRowT[];
}

export const TAX_SYSTEMS: Record<string, string> = { osn: 'ОСН', usn_income: 'УСН «Доходы»', usn_income_outcome: 'УСН «Доходы минус расходы»', esn: 'ЕСХН', patent: 'Патент (ПСН)' };

export const VAT_LABEL: Record<string, string> = {
  none: 'Без НДС', vat0: 'НДС 0%', vat5: 'НДС 5%', vat7: 'НДС 7%', vat10: 'НДС 10%', vat22: 'НДС 22%', vat105: 'НДС 5/105', vat107: 'НДС 7/107', vat110: 'НДС 10/110', vat122: 'НДС 22/122',
};

export interface PayoutAccount {
  number: string;
  name: string;
  holder: string;
  currency: string;
  linkedAt: number;
}
