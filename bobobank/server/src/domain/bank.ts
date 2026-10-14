import { randomDigits } from '../util.js';

/** Bank requisites. The BIK and INN are fictional (the INN check digit is deliberately invalid). */
export const BANK = {
  name: 'Bobobank',
  legalName: 'АО «Бобобанк»',
  bik: '044599909',
  inn: '7799000013',
  kpp: '779901001',
  ogrn: '1267700000001',
  license: '№ 9909',
  address: '123112, г. Москва, Пресненская наб., д. 9',
  phone: '900',
} as const;

const WEIGHTS = [7, 1, 3];

/** Control key of a Russian account number (9th digit), computed against the BIK. */
export function accountKey(bik: string, account20: string): number {
  const digits = (bik.slice(-3) + account20.slice(0, 8) + '0' + account20.slice(9)).split('').map(Number);
  const s = digits.reduce((acc, d, i) => acc + ((d * WEIGHTS[i % 3]) % 10), 0);
  return ((s % 10) * 3) % 10;
}

export const isValidAccount = (bik: string, account20: string) => /^\d{20}$/.test(account20) && accountKey(bik, account20) === Number(account20[8]);

/** Balance account prefixes (first 5 digits of a Russian account number). */
export const PREFIX = {
  current: '40817',
  savings: '40817',
  kids: '40817',
  deposit: '42301',
  credit_card: '45507',
  loan: '45507',
  business_ip: '40802',
  business_ooo: '40702',
  system: '30102',
} as const;

const CURRENCY_CODE: Record<string, string> = { RUB: '810', USD: '840', EUR: '978' };

export function newAccountNumber(prefix: string, currency: string): string {
  const raw = `${prefix}${CURRENCY_CODE[currency] ?? '810'}0${'0000'}${randomDigits(7)}`;
  const key = accountKey(BANK.bik, raw);
  return raw.slice(0, 8) + key + raw.slice(9);
}

export const CORR_ACCOUNT = (() => {
  const raw = `30101810000000000${BANK.bik.slice(-3)}`;
  const digits = (`0${BANK.bik.slice(4, 6)}` + raw.slice(0, 8) + '0' + raw.slice(9)).split('').map(Number);
  const s = digits.reduce((acc, d, i) => acc + ((d * WEIGHTS[i % 3]) % 10), 0);
  return raw.slice(0, 8) + (((s % 10) * 3) % 10) + raw.slice(9);
})();

/** Spending categories shown in history and analytics, with the MCC codes that map to them. */
export const CATEGORIES = {
  groceries: { title: 'Супермаркеты', mcc: [5411, 5422, 5441, 5451, 5462, 5499] },
  restaurants: { title: 'Кафе и рестораны', mcc: [5812, 5813, 5814] },
  transport: { title: 'Транспорт', mcc: [4111, 4121, 4131, 4789, 7523] },
  fuel: { title: 'Топливо', mcc: [5541, 5542, 5983] },
  clothes: { title: 'Одежда и обувь', mcc: [5611, 5621, 5631, 5641, 5651, 5655, 5661, 5691, 5699] },
  electronics: { title: 'Электроника', mcc: [5045, 5065, 5732, 5734] },
  entertainment: { title: 'Развлечения', mcc: [7832, 7841, 7922, 7991, 7996, 7998, 7999] },
  games: { title: 'Игры и подписки', mcc: [5815, 5816, 5817, 5818, 7994] },
  health: { title: 'Здоровье', mcc: [5912, 5122, 8011, 8021, 8043, 8062, 8099] },
  beauty: { title: 'Красота', mcc: [5977, 7230, 7297, 7298] },
  home: { title: 'Дом и ремонт', mcc: [5200, 5211, 5231, 5251, 5712, 5719, 5722] },
  travel: { title: 'Путешествия', mcc: [3000, 4511, 4722, 7011, 7012] },
  education: { title: 'Образование', mcc: [8211, 8220, 8241, 8244, 8249, 8299, 5942] },
  utilities: { title: 'ЖКХ и связь', mcc: [4814, 4899, 4900] },
  services: { title: 'Сервисы', mcc: [7299, 7399, 8999] },
  shopping: { title: 'Покупки', mcc: [5311, 5331, 5399, 5999] },
  transfers: { title: 'Переводы', mcc: [] },
  income: { title: 'Пополнения', mcc: [] },
  cash: { title: 'Наличные', mcc: [6010, 6011] },
  fees: { title: 'Комиссии', mcc: [] },
  credit: { title: 'Кредиты', mcc: [] },
  savings: { title: 'Вклады и накопления', mcc: [] },
  fx: { title: 'Обмен валют', mcc: [] },
  bonus: { title: 'Бонусы', mcc: [] },
  other: { title: 'Другое', mcc: [] },
} as const satisfies Record<string, { title: string; mcc: number[] }>;

export type Category = keyof typeof CATEGORIES;

/** Categories a customer can pick for raised cashback (purchase categories only). */
export const CASHBACK_CATEGORIES: Category[] = ['groceries', 'restaurants', 'transport', 'fuel', 'clothes', 'electronics', 'entertainment', 'games', 'health', 'beauty', 'home', 'travel', 'education', 'utilities'];

export function categoryOfMcc(mcc: number | null | undefined): Category {
  if (!mcc) return 'shopping';
  for (const [k, v] of Object.entries(CATEGORIES)) if ((v.mcc as readonly number[]).includes(mcc)) return k as Category;
  return 'shopping';
}

export const RESTRICTION_REASONS = {
  fssp: 'Постановление судебного пристава (ФССП)',
  tax: 'Решение налогового органа (ФНС)',
  aml: 'Проверка операций по 115-ФЗ',
  court: 'Решение суда',
  fraud: 'Подозрение на мошенничество',
  client: 'По заявлению клиента',
  debt: 'Просроченная задолженность',
  other: 'Иное основание',
} as const;
export type RestrictionReason = keyof typeof RESTRICTION_REASONS;

export const RESTRICTION_TYPES = {
  arrest: 'Арест средств',
  block_debit: 'Запрет списаний',
  block_full: 'Блокировка счёта',
} as const;
export type RestrictionType = keyof typeof RESTRICTION_TYPES;
