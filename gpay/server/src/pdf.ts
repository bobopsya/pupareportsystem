import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { humanMoney } from './domain/money.js';
import type { FiscalReceipt } from './domain/receipts.js';

const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const font = (name: string) => path.join(FONT_DIR, name);
// assets/ sits next to src/ and dist/, so the same relative path works in dev, tests and the container.
const MARK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'gpay-mark.png');

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function drawQr(doc: PDFKit.PDFDocument, text: string, x: number, y: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const cell = size / n;
  doc.save().fillColor('#000');
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.modules.get(r, c)) doc.rect(x + c * cell, y + r * cell, cell + 0.05, cell + 0.05).fill();
  doc.restore();
}

const num = (minor: number) => (minor / 100).toFixed(2);

const moscow = (ts: number) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ts)).replace(',', '');

/** Cash register tape (80 mm) with all fiscal attributes. */
export async function receiptPdf(r: FiscalReceipt): Promise<Buffer> {
  const W = 226;
  const M = 12;
  const inner = W - M * 2;
  // Height is estimated generously and the page is cropped by content length.
  const est = 420 + r.items.length * 70 + r.vatTotals.length * 12;
  const doc = new PDFDocument({ size: [W, est], margins: { top: M, bottom: M, left: M, right: M }, info: { Title: `Кассовый чек №${r.kkt.fd}`, Author: 'GPAY ОФД' } });
  doc.registerFont('mono', font('DejaVuSansMono.ttf'));
  doc.registerFont('mono-b', font('DejaVuSansMono-Bold.ttf'));
  doc.font('mono').fontSize(7.2).fillColor('#111');

  const line = (left: string, right = '', bold = false) => {
    doc.font(bold ? 'mono-b' : 'mono');
    const y = doc.y;
    if (right) {
      doc.text(right, M, y, { width: inner, align: 'right' });
      doc.text(left, M, y, { width: inner - doc.widthOfString(right) - 6 });
    } else doc.text(left, M, y, { width: inner });
  };
  const center = (t: string, bold = false, size = 7.2) => {
    doc.font(bold ? 'mono-b' : 'mono').fontSize(size).text(t, M, doc.y, { width: inner, align: 'center' });
    doc.fontSize(7.2);
  };
  const dash = () => {
    doc.moveDown(0.3);
    doc.save().strokeColor('#999').dash(1.5, { space: 1.5 }).moveTo(M, doc.y).lineTo(W - M, doc.y).stroke().restore();
    doc.moveDown(0.5);
  };

  center(r.seller.legalName, true);
  center(`ИНН ${r.seller.inn}`);
  if (r.seller.site) center(`Место расчётов: ${r.seller.site}`);
  doc.moveDown(0.4);
  center('КАССОВЫЙ ЧЕК', true, 9);
  center(r.kind === 'income' ? 'ПРИХОД' : 'ВОЗВРАТ ПРИХОДА', true, 8.5);
  doc.moveDown(0.3);
  line(`СМЕНА № ${r.kkt.shift}`, `ЧЕК № ${r.kkt.checkNo}`);
  line(moscow(r.kkt.ts), `ФД № ${r.kkt.fd}`);
  dash();
  r.items.forEach((it, i) => {
    line(`${i + 1}. ${it.name}`, '', true);
    line(`  ${it.quantity} x ${num(it.price)}`, `=${num(it.sum)}`);
    line(`  ${it.vat}`, it.vatSum ? `=${num(it.vatSum)}` : '');
    line(`  ${it.subject}`);
    line(`  ${it.mode}`);
    doc.moveDown(0.3);
  });
  dash();
  doc.fontSize(9.5);
  line('ИТОГ', `=${num(r.total)}`, true);
  doc.fontSize(7.2);
  line(r.method, `=${num(r.total)}`);
  for (const v of r.vatTotals) line(`СУММА ${v.label}`, `=${num(v.sum)}`);
  dash();
  line('СНО', r.seller.taxSystem);
  if (r.customerEmail) line('ЭЛ. АДР. ПОКУПАТЕЛЯ', r.customerEmail);
  line('ЭЛ. АДР. ОТПРАВИТЕЛЯ', `receipts@${new URL(r.ofd.site).hostname}`);
  line('САЙТ ПРОВЕРКИ', r.ofd.site.replace(/^https?:\/\//, ''));
  line('ОФД', r.ofd.name);
  line('ИНН ОФД', r.ofd.inn);
  dash();
  line('РН ККТ', r.kkt.rn);
  line('ЗН ККТ', r.kkt.zn);
  line('ФН', r.kkt.fn);
  line('ФД', String(r.kkt.fd));
  line('ФП', r.kkt.fpd);
  doc.moveDown(0.6);
  const q = 100;
  drawQr(doc, r.qr, (W - q) / 2, doc.y, q);
  doc.y += q + 6;
  center('Спасибо за покупку!');
  center('Чек сформирован GPAY Касса');
  // Crop the page to what was drawn. PDF y grows upwards, so keep the top band of the page.
  const used = Math.min(est, doc.y + M + 4);
  (doc.page.dictionary.data as unknown as { MediaBox: number[] }).MediaBox = [0, est - used, W, est];
  return toBuffer(doc);
}

export interface Quittance {
  shopName: string;
  legalName: string;
  inn: string;
  amount: number;
  fee: number;
  currency: string;
  description: string;
  status: string;
  method: string;
  paymentId: string;
  operationId: string;
  rrn: string;
  authCode: string;
  ts: number;
  refunded: number;
}

/** Bank-style payment confirmation (A5). */
export async function quittancePdf(q: Quittance): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A5', margins: { top: 40, bottom: 40, left: 40, right: 40 }, info: { Title: `Квитанция ${q.paymentId}`, Author: 'GPAY' } });
  doc.registerFont('sans', font('DejaVuSans.ttf'));
  doc.registerFont('sans-b', font('DejaVuSans-Bold.ttf'));
  const W = doc.page.width;
  const inner = W - 80;

  // Brand header.
  doc.image(MARK, 40, 36, { width: 30, height: 30 });
  doc.font('sans-b').fontSize(17).fillColor('#0b0b14').text('GPAY', 78, 41);
  doc.font('sans').fontSize(8).fillColor('#6b6b80').text('GnusaPay · платёжный сервис', 78, 60);

  doc.font('sans').fontSize(9).fillColor('#6b6b80').text('Квитанция об оплате', 40, 100);
  doc.font('sans-b').fontSize(26).fillColor('#0b0b14').text(humanMoney(q.amount, q.currency), 40, 114);
  const statusText = q.refunded >= q.amount ? 'Возвращён' : q.refunded ? 'Частично возвращён' : 'Успешно';
  const statusColor = q.refunded ? '#b45309' : '#0f9d58';
  doc.font('sans-b').fontSize(9).fillColor(statusColor).text(`● ${statusText}`, 40, 150);

  let y = 182;
  const row = (k: string, v: string) => {
    doc.font('sans').fontSize(8.5).fillColor('#6b6b80').text(k, 40, y, { width: 150 });
    doc.font('sans').fontSize(8.5).fillColor('#0b0b14').text(v, 190, y, { width: inner - 150, align: 'right' });
    y = Math.max(doc.y, y + 12) + 7;
    doc.save().strokeColor('#ececf2').lineWidth(0.6).moveTo(40, y - 4).lineTo(W - 40, y - 4).stroke().restore();
  };
  row('Дата и время (МСК)', moscow(q.ts));
  row('Получатель', q.shopName);
  row('Юридическое лицо', q.legalName);
  row('ИНН получателя', q.inn);
  if (q.description) row('Назначение', q.description);
  row('Способ оплаты', q.method);
  row('Сумма', humanMoney(q.amount, q.currency));
  if (q.refunded) row('Возвращено', humanMoney(q.refunded, q.currency));
  row('Номер платежа', q.paymentId);
  row('Номер операции', q.operationId);
  if (q.rrn) row('RRN', q.rrn);
  if (q.authCode) row('Код авторизации', q.authCode);

  y += 14;
  doc.save().roundedRect(40, y, inner, 64, 10).lineWidth(1.4).strokeColor('#333333').stroke().restore();
  doc.font('sans-b').fontSize(10).fillColor('#333333').text('ПРОВЕДЕНО', 40, y + 14, { width: inner, align: 'center' });
  doc.font('sans').fontSize(7.5).fillColor('#555555').text(`GPAY · ${moscow(q.ts)} · ${q.operationId.slice(-12)}`, 40, y + 32, { width: inner, align: 'center' });

  doc.font('sans').fontSize(7).fillColor('#9a9aae').text('ООО «ГнусаПэй» · Лицензия на осуществление переводов денежных средств № 3517-П. Квитанция сформирована автоматически и не требует подписи.', 40, doc.page.height - 70, { width: inner, align: 'center' });
  return toBuffer(doc);
}
