import { createRequire } from 'node:module';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { Ctx } from './context.js';
import type { Car, Driver } from './domain/fleet.js';
import type { Point, RideExtra, RideRow } from './domain/rides.js';
import { getSettings, tariffOf, waitingPrice } from './domain/tariffs.js';
import { safeJson } from './util.js';

const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const font = (name: string) => path.join(FONT_DIR, name);

const rub = (k: number) => `${(k / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, ' ')} ₽`;
const msk = (ts: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ts).replace(',', '');

/** Ride receipt (A6): route, car, price breakdown, the charge in Bobobank. */
export function receiptPdf(ctx: Ctx, r: RideRow): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A6', margin: 22, info: { Title: `Бобо.Транспорт — поездка ${r.id}`, Author: 'Бобо.Транспорт' } });
  doc.registerFont('r', font('DejaVuSans.ttf'));
  doc.registerFont('b', font('DejaVuSans-Bold.ttf'));
  const W = doc.page.width - 44;
  const from = safeJson<Point>(r.from_json, {} as Point);
  const to = safeJson<Point>(r.to_json, {} as Point);
  const car = safeJson<Car | null>(r.car, null);
  const driver = safeJson<Driver | null>(r.driver, null);
  const t = tariffOf(ctx, r.tariff);

  doc.rect(0, 0, doc.page.width, 54).fill('#FFD600');
  doc.fill('#111').font('b').fontSize(15).text('Бобо.Транспорт', 22, 18);
  doc.font('r').fontSize(7).text('Игровой транспорт Москвы · оплата через Bobobank', 22, 37);
  doc.moveDown(2.2);

  const line = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc.font('r').fontSize(8).fill('#666').text(label, 22, y, { width: W * 0.45 });
    doc.font(bold ? 'b' : 'r').fontSize(bold ? 10 : 8).fill('#111').text(value, 22 + W * 0.45, y, { width: W * 0.55, align: 'right' });
    doc.moveDown(0.35);
  };
  const extra = safeJson<RideExtra>(r.extra, {});
  const what = r.mode === 'bus' ? `${extra.bus?.kind === 'trolleybus' ? 'Троллейбус' : 'Автобус'} ${extra.bus?.ref ?? ''}` : r.mode === 'heli' ? 'Вертолёт' : r.mode === 'jet' ? 'Частный джет' : 'Поездка';
  doc.fill('#111').font('b').fontSize(11).text(r.status === 'cancelled' ? `Отмена заказа · ${what}` : what, 22, 66);
  doc.font('r').fontSize(8).fill('#666').text(msk(r.finished_at ?? r.cancelled_at ?? r.created_at));
  doc.moveDown(0.6);
  doc.fill('#111').font('b').fontSize(8.5).text(`● ${from.title}`);
  if (from.subtitle) doc.font('r').fontSize(7).fill('#666').text(`   ${from.subtitle}`);
  doc.fill('#111').font('b').fontSize(8.5).text(`■ ${to.title}`);
  if (to.subtitle) doc.font('r').fontSize(7).fill('#666').text(`   ${to.subtitle}`);
  doc.moveDown(0.6);
  if (extra.air) {
    line('Класс', `${extra.air.className}, до ${extra.air.seats} пассажиров`);
    if (car) line('Борт', `${car.model}, ${car.plate}`);
    if (driver) line('Командир', driver.name);
    line('Расстояние', `${Math.round(r.distance_m / 1000)} км`);
  } else if (extra.bus) {
    line('Маршрут', `${extra.bus.ref} → ${extra.bus.to}`);
    line('Проехали', `${extra.bus.stops} остановок, ${((r.distance_m * (r.progress ?? 1)) / 1000).toFixed(1).replace('.', ',')} км`);
  } else {
    line('Тариф', t?.title ?? r.tariff);
    if (car) line('Машина', `${car.color} ${car.model}, ${car.plate}`);
    if (driver) line('Водитель', driver.name);
  }
  if (r.status === 'completed' && r.mode === 'taxi') {
    line('Расстояние', `${((r.distance_m * (r.progress ?? 1)) / 1000).toFixed(1).replace('.', ',')} км`);
    if (r.surge > 1) line('Повышенный спрос', `×${r.surge.toFixed(1).replace('.', ',')}`);
    const wait = t ? waitingPrice(t, r.wait_paid_s) : 0;
    if (wait) line('Платное ожидание', rub(wait));
    if (r.child_seat) line('Детское кресло', rub(getSettings(ctx).childSeat * 100));
  }
  doc.moveDown(0.3);
  doc.moveTo(22, doc.y).lineTo(22 + W, doc.y).strokeColor('#DDD').stroke();
  doc.moveDown(0.5);
  line('Итого', rub(r.final_price ?? 0), true);
  if (r.tip) line('Чаевые (отдельно)', rub(r.tip));
  line('Оплата', 'Счёт Bobobank');
  doc.moveDown(0.8);
  doc.font('r').fontSize(6.5).fill('#999').text(`Заказ ${r.id}. Чек сформирован Бобо.Транспортом; деньги списаны в Bobobank. Игровой документ, не является фискальным чеком.`, 22, doc.y, { width: W });

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}
