import type { Ctx } from '../context.js';
import { getSetting, setSetting } from '../db.js';

/** Prices in rubles; quotas per paid period, -1 = unlimited. */
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
  /** Roaming for so many days. */
  roamingDays?: number;
}

export interface Settings {
  tariffs: Tariff[];
  addons: Addon[];
}

export const DEFAULT_TARIFFS: Tariff[] = [
  { id: 'mini', title: 'Мини', price: 299, minutes: 200, gb: 5, sms: 50, perks: ['Хватит, чтобы быть на связи', 'Пакеты можно докупить'] },
  { id: 'base', title: 'Базовый', price: 549, minutes: 600, gb: 25, sms: 100, perks: ['Мессенджеры не тратят гигабайты', 'Остаток минут не сгорает до конца периода'] },
  { id: 'unlim', title: 'Безлимит', price: 999, minutes: -1, gb: -1, sms: 300, perks: ['Безлимитные звонки и интернет', 'Раздача интернета'] },
  { id: 'premium', title: 'Премиум', price: 1999, minutes: -1, gb: -1, sms: -1, perks: ['Всё без лимита', 'Роуминг 7 дней каждый месяц', 'Красивый номер со скидкой 50%'] },
];

export const DEFAULT_ADDONS: Addon[] = [
  { id: 'gb10', title: '+10 ГБ', price: 199, gb: 10 },
  { id: 'min300', title: '+300 минут', price: 149, minutes: 300 },
  { id: 'sms100', title: '+100 SMS', price: 79, sms: 100 },
  { id: 'roaming7', title: 'Роуминг на 7 дней', price: 990, roamingDays: 7 },
];

export function getSettings(ctx: Ctx): Settings {
  const s = getSetting<Partial<Settings>>(ctx.db, 'settings', {});
  return { tariffs: s.tariffs?.length ? s.tariffs : DEFAULT_TARIFFS, addons: s.addons?.length ? s.addons : DEFAULT_ADDONS };
}

export function saveSettings(ctx: Ctx, patch: Partial<Settings>) {
  const cur = getSetting<Partial<Settings>>(ctx.db, 'settings', {});
  setSetting(ctx.db, 'settings', { ...cur, ...patch });
}

export const tariffOf = (ctx: Ctx, id: string) => getSettings(ctx).tariffs.find((t) => t.id === id);
export const addonOf = (ctx: Ctx, id: string) => getSettings(ctx).addons.find((a) => a.id === id);

/** Quotas of a fresh period: minutes, megabytes, SMS. */
export const quotas = (t: Tariff) => ({ minutes: t.minutes, mb: t.gb < 0 ? -1 : t.gb * 1024, sms: t.sms });
