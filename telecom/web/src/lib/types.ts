export interface Me {
  user: {
    id: string;
    name: string;
    role: 'subscriber' | 'admin';
    phone: string;
    linked: boolean;
    accountLast4: string | null;
    /** The number Bobobank sends transfers to (synced from the line). */
    bankPhone: string | null;
    gos: { login: string; name: string; passport: string | null; phone: string | null; since: number } | null;
  } | null;
  bankUrl: string | null;
  bankEnabled: boolean;
  gosEnabled: boolean;
}

export interface Account {
  linked: boolean;
  accountLast4?: string;
  accountName?: string;
  available?: number;
  limit?: number;
  unavailable?: boolean;
}

/** Prices in rubles, quotas per period; -1 = unlimited. */
export interface Tariff {
  id: string;
  title: string;
  price: number;
  minutes: number;
  gb: number;
  sms: number;
  perks: string[];
}

export interface Addon {
  id: string;
  title: string;
  price: number;
  minutes?: number;
  gb?: number;
  sms?: number;
  roamingDays?: number;
}

export interface Line {
  id: string;
  number: string;
  formatted: string;
  status: 'active' | 'blocked';
  blockReason: 'debt' | 'admin' | 'no_mandate' | null;
  tariff: Tariff;
  nextTariff: Tariff | null;
  periodStart: number;
  periodEnd: number;
  nextCharge: { at: number | null; amount: number };
  left: { minutes: number; mb: number; sms: number };
  used: { minutes: number; mb: number; sms: number };
  total: { minutes: number; mb: number; sms: number };
  roamingUntil: number | null;
  esim: string;
  createdAt: number;
}

export interface Call {
  id: string;
  direction: 'in' | 'out';
  number: string;
  formatted: string;
  name: string | null;
  status: 'ringing' | 'active' | 'ended' | 'missed' | 'declined' | 'busy';
  createdAt: number;
  answeredAt: number | null;
  endedAt: number | null;
  seconds: number;
  billedMin: number;
  now: number;
}

export interface LineState {
  line: Line | null;
  unread: number;
  call: Call | null;
  now: number;
}

export interface Chat {
  number: string;
  formatted: string;
  name: string | null;
  system: boolean;
  last: { text: string; mine: boolean; at: number };
  unread: number;
}

export interface Conversation {
  number: string;
  formatted: string;
  name: string | null;
  system: boolean;
  messages: { id: string; text: string; mine: boolean; createdAt: number }[];
}

export interface Charge {
  id: string;
  kind: 'number' | 'subscription' | 'change' | 'addon';
  title: string;
  amount: number;
  status: 'paid' | 'refunded' | 'failed' | 'pending';
  refunded: number;
  createdAt: number;
  paidAt: number | null;
}

export interface NumberOffer {
  number: string;
  formatted: string;
  price: number;
}
