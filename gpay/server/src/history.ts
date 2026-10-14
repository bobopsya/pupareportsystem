import type { Config } from './config.js';
import { createCtx } from './context.js';
import type { DB } from './db.js';
import { capturePayment, createPayment, getShop, payWithCard, refundPayment, settle, startAsync, getPaymentRow } from './domain/payments.js';

const PRODUCTS: [string, number, string][] = [
  ['Капучино 0,4 л', 32000, 'vat22'], ['Латте на овсяном', 36000, 'vat22'], ['Круассан миндальный', 29000, 'vat10'], ['Зерно «Эфиопия» 250 г', 89000, 'vat10'],
  ['Сертификат на 3000 ₽', 300000, 'vat22'], ['Набор для пуровера', 459000, 'vat22'], ['Сырники со сметаной', 42000, 'vat10'], ['Абонемент на 10 кофе', 280000, 'vat22'],
];
const CARDS = ['4111111111111111', '5555555555554444', '2200000000000004', '2200000000000004', '6200000000000005'];
const DECLINES = ['4000000000009995', '4000000000000002', '4000000000000119', '4000000000000127'];
const EMAILS = ['ivan.petrov@mail.ru', 'anna.k@yandex.ru', 'sergey88@gmail.com', 'olga.smirnova@bk.ru', 'dmitry@company.ru', 'm.ivanova@inbox.ru', null];

/**
 * Replays `days` of plausible traffic through the real payment flow with a shifted clock,
 * so balances, receipts, fees and analytics are all consistent.
 */
export function generateHistory(cfg: Config, db: DB, shopId: number, days: number): number {
  let clock = Date.now() - days * 86400_000;
  const ctx = createCtx(db, cfg, () => clock);
  const shop = getShop(ctx, shopId);
  if (!shop) throw new Error('Магазин не найден');
  let seed = shopId * 7919;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
  let count = 0;
  for (let d = days; d >= 1; d--) {
    const dayStart = Date.now() - d * 86400_000;
    const weekend = new Date(dayStart).getDay() % 6 === 0;
    const n = Math.round((4 + (days - d) * 0.12 + rnd() * 6) * (weekend ? 1.4 : 1));
    for (let i = 0; i < n; i++) {
      clock = dayStart + Math.floor(rnd() * 86400_000);
      const lines = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(PRODUCTS));
      const items = lines.map(([description, price, vat]) => ({ description, quantity: 1, amount: { value: (price / 100).toFixed(2), currency: 'RUB' }, vat_code: vat }));
      const amount = lines.reduce((s, l) => s + l[1], 0);
      const email = pick(EMAILS) ?? undefined;
      const twoStage = rnd() < 0.08;
      const p = createPayment(ctx, shop, {
        amount, currency: 'RUB', description: `Заказ №${4000 + count}`, capture: !twoStage, source: rnd() < 0.3 ? 'link' : 'api',
        receipt: { customer: { email }, items }, metadata: { order_id: String(4000 + count) },
      });
      count++;
      const r = rnd();
      clock += 40_000;
      if (r < 0.08) continue; // abandoned: expires later
      if (r < 0.2) payWithCard(ctx, getPaymentRow(ctx, p.id)!, { pan: pick(DECLINES), expMonth: 12, expYear: 2030, csc: '123' });
      clock += 30_000;
      const method = rnd();
      if (method < 0.55) payWithCard(ctx, getPaymentRow(ctx, p.id)!, { pan: pick(CARDS), expMonth: 11, expYear: 2029, csc: '321', email });
      else {
        const type = method < 0.85 ? 'sbp' : method < 0.94 ? 'installments' : 'crypto';
        startAsync(ctx, getPaymentRow(ctx, p.id)!, { type, phone: '79161234567', asset: 'USDT', email });
        clock += 20_000;
        settle(ctx, getPaymentRow(ctx, p.id)!);
      }
      const after = getPaymentRow(ctx, p.id)!;
      if (after.status === 'waiting_for_capture' && d > 1) {
        clock += 3600_000;
        capturePayment(ctx, shop, after);
      }
      if (getPaymentRow(ctx, p.id)!.status === 'succeeded' && rnd() < 0.05) {
        clock += 7200_000;
        try {
          refundPayment(ctx, shop, getPaymentRow(ctx, p.id)!, rnd() < 0.5 ? undefined : Math.round(amount / 3), 'Покупатель отказался от части заказа');
        } catch {
          // The shop balance does not cover the refund yet; history just skips it.
        }
      }
    }
  }
  // Older unpaid payments become expired.
  clock = Date.now();
  for (const row of db.prepare(`SELECT * FROM payments WHERE shop_id = ? AND status = 'pending'`).all(shopId) as Parameters<typeof settle>[1][]) settle(ctx, row);
  return count;
}
