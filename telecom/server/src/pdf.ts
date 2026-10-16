import { createRequire } from 'node:module';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import type { ChargeRow } from './domain/lines.js';
import { formatNumber } from './domain/numbers.js';

const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const font = (name: string) => path.join(FONT_DIR, name);

const rub = (k: number) => `${(k / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, ' ')} ₽`;
const msk = (ts: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ts).replace(',', '');
const KIND: Record<ChargeRow['kind'], string> = { number: 'Красивый номер', subscription: 'Абонентская плата', change: 'Смена тарифа', addon: 'Дополнительный пакет', home: 'Домашний интернет', router: 'Wi‑Fi роутер' };

/** Receipt of one charge (A6). */
export function receiptPdf(c: ChargeRow, number: string | null, name: string, contract?: string | null): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A6', margin: 22, info: { Title: `Бобтелеком — чек ${c.id}`, Author: 'Бобтелеком' } });
  doc.registerFont('r', font('DejaVuSans.ttf'));
  doc.registerFont('b', font('DejaVuSans-Bold.ttf'));
  const W = doc.page.width - 44;
  doc.rect(0, 0, doc.page.width, 54).fill('#5B4BFF');
  doc.fill('#fff').font('b').fontSize(15).text('Бобтелеком', 22, 18);
  doc.font('r').fontSize(7).text('Игровой оператор связи · оплата через Bobobank', 22, 37);
  const line = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc.font('r').fontSize(8).fill('#666').text(label, 22, y, { width: W * 0.42 });
    doc.font(bold ? 'b' : 'r').fontSize(bold ? 10 : 8).fill('#111').text(value, 22 + W * 0.42, y, { width: W * 0.58, align: 'right' });
    doc.moveDown(0.35);
  };
  doc.fill('#111').font('b').fontSize(11).text(KIND[c.kind], 22, 66);
  doc.font('r').fontSize(8).fill('#666').text(msk(c.paid_at ?? c.created_at));
  doc.moveDown(0.8);
  line('Абонент', name);
  if (number) line('Номер', formatNumber(number));
  if (contract) line('Договор', contract);
  line('Услуга', c.title);
  doc.moveDown(0.3);
  doc.moveTo(22, doc.y).lineTo(22 + W, doc.y).strokeColor('#DDD').stroke();
  doc.moveDown(0.5);
  line('Итого', rub(c.amount), true);
  if (c.refunded) line('Возвращено', rub(c.refunded));
  line('Оплата', 'Счёт Bobobank');
  doc.moveDown(0.8);
  doc.font('r').fontSize(6.5).fill('#999').text(`Операция ${c.id}. Чек сформирован Бобтелекомом; деньги списаны в Bobobank. Игровой документ, не является фискальным чеком.`, 22, doc.y, { width: W });
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (b: Buffer) => chunks.push(b));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}
