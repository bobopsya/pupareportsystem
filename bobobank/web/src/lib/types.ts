export type AccountKind = 'current' | 'savings' | 'deposit' | 'credit_card' | 'loan' | 'business' | 'kids';

export interface Account {
  id: string;
  number: string;
  kind: AccountKind;
  currency: string;
  name: string;
  balance: number;
  creditLimit: number;
  available: number;
  held: number;
  arrested: number;
  status: 'open' | 'closed';
  params: Record<string, unknown>;
  createdAt: number;
}

export type Network = 'mir' | 'visa' | 'mastercard' | 'unionpay';

export interface Card {
  id: string;
  network: Network;
  networkTitle: string;
  kind: 'debit' | 'credit';
  form: 'plastic' | 'virtual';
  tariff: 'standard' | 'prime' | 'kids';
  tariffTitle: string;
  design: string;
  holder: string;
  masked: string;
  last4: string;
  exp: string;
  status: 'active' | 'frozen' | 'blocked' | 'closed';
  statusReason: string | null;
  limits: { monthly: number; online: boolean };
  confirmPurchases: boolean;
  accountId: string;
  accountNumber?: string;
  currency: string;
  createdAt: number;
}

export interface Entry {
  id: number;
  txId: string;
  kind: string;
  accountId: string;
  accountName: string;
  accountKind: string;
  amount: number;
  currency: string;
  balanceAfter: number;
  title: string;
  subtitle: string;
  category: string;
  categoryTitle: string;
  card: { last4: string; network: Network } | null;
  createdAt: number;
}

export interface Restriction {
  id: string;
  type: 'arrest' | 'block_debit' | 'block_full';
  typeTitle: string;
  reason: string;
  reasonTitle: string;
  comment: string;
  amount: number;
  accountId: string | null;
  createdAt: number;
}

export interface Confirmation {
  id: string;
  status: string;
  amount: number;
  currency: string;
  accountAmount: number;
  merchant: { name: string; site?: string; mcc?: number };
  card: Card | null;
  createdAt: number;
  expiresAt: number;
}

export interface Profile {
  id: string;
  phone: string;
  phoneFormatted: string;
  /** Бобтелеком number, when the customer has one. */
  telecomPhone: string | null;
  name: string;
  birthDate: string;
  role: string;
  tariff: 'standard' | 'prime';
  tariffTitle: string;
  tariffPaidUntil: number | null;
  bonus: number;
  createdAt: number;
  gos: GosStatus;
}

/** Identity from Бобуслуги: required when the bank is connected to them. */
export interface GosStatus {
  required: boolean;
  ok: boolean;
  linked?: boolean;
  passport?: { number: string; country_code: string } | null;
  login?: string | null;
  role?: string | null;
  country?: string | null;
}

export interface Loan {
  id: string;
  principal: number;
  rate: number;
  term: number;
  payment: number;
  penalty: number;
  status: 'active' | 'overdue' | 'closed';
  debt: number;
  paidCount: number;
  next: { n: number; dueAt: number; amount: number } | null;
  schedule: { n: number; dueAt: number; payment: number; principal: number; interest: number; paid: boolean }[];
  payoutAccountId: string;
  createdAt: number;
}

export interface Application {
  id: string;
  product: 'loan' | 'credit_card';
  amount: number;
  term: number;
  status: 'processing' | 'review' | 'approved' | 'rejected' | 'issued' | 'canceled';
  offerAmount: number | null;
  offerRate: number | null;
  reason: string | null;
  createdAt: number;
}

export interface Home {
  profile: Profile;
  accounts: Account[];
  cards: Card[];
  recent: Entry[];
  restrictions: Restriction[];
  confirmations: Confirmation[];
  unread: number;
  chatUnread: number;
  totalRub: number;
  loans: Loan[];
  applications: Application[];
}

export const ACCOUNT_KIND_TITLE: Record<AccountKind, string> = {
  current: 'Платёжный счёт',
  savings: 'Накопительный счёт',
  deposit: 'Вклад',
  credit_card: 'Кредитная карта',
  loan: 'Кредит',
  business: 'Бизнес-счёт',
  kids: 'Детский счёт',
};
