import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { BANK, CORR_ACCOUNT } from './domain/bank.js';
import { humanMoney } from './domain/money.js';

const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const font = (name: string) => path.join(FONT_DIR, name);
// assets/ sits next to src/ and dist/, so the same relative path works in dev, tests and the container.
const MARK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'bobobank-mark.png');
const GREEN = '#0d9f61';

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

const moscow = (ts: number, withTime = true) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : {}) })
    .format(new Date(ts))
    .replace(',', '');

function setup(doc: PDFKit.PDFDocument) {
  doc.registerFont('r', font('DejaVuSans.ttf'));
  doc.registerFont('b', font('DejaVuSans-Bold.ttf'));
  doc.font('r').fillColor('#111');
}

function header(doc: PDFKit.PDFDocument, x: number, y: number) {
  if (fs.existsSync(MARK)) doc.image(MARK, x, y, { width: 26, height: 26 });
  doc.font('b').fontSize(15).fillColor('#111').text('Bobobank', x + 34, y + 4);
}

export interface OperationReceipt {
  id: string;
  createdAt: number;
  kind: string;
  title: string;
  amount: number;
  currency: string;
  fee: number;
  rows: [string, string][];
}

/** «Чек по операции» as banking apps issue it: one page, amount up top, details below, a stamp. */
export async function operationPdf(r: OperationReceipt): Promise<Buffer> {
  const W = 340;
  const M = 28;
  const doc = new PDFDocument({ size: [W, 470 + r.rows.length * 34], margins: { top: M, bottom: M, left: M, right: M }, info: { Title: `Чек по операции ${r.id}`, Author: BANK.legalName } });
  setup(doc);
  header(doc, M, M);
  doc.font('r').fontSize(8).fillColor('#777').text(moscow(r.createdAt), M, M + 9, { width: W - M * 2, align: 'right' });
  doc.moveDown(2.2);
  doc.font('b').fontSize(13).fillColor('#111').text('Чек по операции', M, doc.y);
  doc.font('r').fontSize(9).fillColor('#555').text(r.kind, M, doc.y + 2);
  doc.moveDown(1);
  doc.font('b').fontSize(24).fillColor('#111').text(humanMoney(r.amount, r.currency), M, doc.y);
  if (r.fee) doc.font('r').fontSize(9).fillColor('#555').text(`Комиссия ${humanMoney(r.fee, r.currency)}`, M, doc.y + 2);
  doc.moveDown(1);
  const rowsY = doc.y;
  doc.moveTo(M, rowsY).lineTo(W - M, rowsY).strokeColor('#e3e5e8').lineWidth(0.8).stroke();
  let y = rowsY + 10;
  for (const [k, v] of [['Операция', r.title] as [string, string], ...r.rows]) {
    doc.font('r').fontSize(8).fillColor('#888').text(k, M, y, { width: W - M * 2 });
    doc.font('r').fontSize(10).fillColor('#111').text(v, M, doc.y + 1, { width: W - M * 2 });
    y = doc.y + 8;
  }
  doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#e3e5e8').stroke();
  y += 14;
  doc.font('r').fontSize(8).fillColor('#888').text('Номер документа', M, y);
  doc.font('r').fontSize(9).fillColor('#111').text(r.id, M, doc.y + 1);
  y = doc.y + 18;
  // Round "operation completed" stamp.
  const cx = W - M - 46;
  const cy = y + 30;
  doc.save().circle(cx, cy, 42).lineWidth(1.6).strokeColor(GREEN).stroke();
  doc.circle(cx, cy, 36).lineWidth(0.6).stroke();
  doc.font('b').fontSize(8).fillColor(GREEN).text('BOBOBANK', cx - 36, cy - 16, { width: 72, align: 'center' });
  doc.font('b').fontSize(9).text('ВЫПОЛНЕНО', cx - 36, cy - 4, { width: 72, align: 'center' });
  doc.font('r').fontSize(6.5).text(moscow(r.createdAt, false), cx - 36, cy + 9, { width: 72, align: 'center' });
  doc.restore();
  doc.font('r').fontSize(7.5).fillColor('#888').text(`${BANK.legalName}\nБИК ${BANK.bik} · ИНН ${BANK.inn}\nЛицензия Банка России ${BANK.license}\nПо вопросам: ${BANK.phone}`, M, y + 4, { width: W - M * 2 - 100 });
  return toBuffer(doc);
}

export interface StatementLine {
  ts: number;
  title: string;
  subtitle: string;
  amount: number;
}

/** A4 account statement for a period. */
export async function statementPdf(s: { holder: string; accountName: string; number: string; currency: string; from: number; to: number; opening: number; closing: number; lines: StatementLine[] }): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 48, left: 48, right: 48 }, info: { Title: `Выписка по счёту ${s.number}`, Author: BANK.legalName } });
  setup(doc);
  const W = doc.page.width - 96;
  header(doc, 48, 44);
  doc.font('r').fontSize(8).fillColor('#777').text(`${BANK.legalName}\nБИК ${BANK.bik}, ИНН ${BANK.inn}`, 48, 48, { width: W, align: 'right' });
  doc.moveDown(2.5);
  doc.font('b').fontSize(16).fillColor('#111').text('Выписка по счёту', 48);
  doc.font('r').fontSize(10).fillColor('#444').text(`за период с ${moscow(s.from, false)} по ${moscow(s.to, false)}`);
  doc.moveDown(0.8);
  const kv = (k: string, v: string) => {
    const y = doc.y;
    doc.font('r').fontSize(9).fillColor('#777').text(k, 48, y, { width: 160 });
    doc.font('r').fontSize(9).fillColor('#111').text(v, 210, y, { width: W - 162 });
    doc.moveDown(0.25);
  };
  kv('Владелец', s.holder);
  kv('Счёт', `${s.accountName}, ${s.number}`);
  kv('Валюта', s.currency);
  kv('Входящий остаток', humanMoney(s.opening, s.currency));
  const credit = s.lines.filter((l) => l.amount > 0).reduce((a, l) => a + l.amount, 0);
  const debit = s.lines.filter((l) => l.amount < 0).reduce((a, l) => a - l.amount, 0);
  kv('Поступления', humanMoney(credit, s.currency));
  kv('Списания', humanMoney(debit, s.currency));
  kv('Исходящий остаток', humanMoney(s.closing, s.currency));
  doc.moveDown(1);
  const cols = [48, 150, W + 48 - 110];
  const head = () => {
    const y = doc.y;
    doc.rect(48, y - 4, W, 20).fill('#f1f3f2');
    doc.font('b').fontSize(8.5).fillColor('#333');
    doc.text('Дата', cols[0] + 6, y + 1);
    doc.text('Операция', cols[1], y + 1);
    doc.text('Сумма', cols[2], y + 1, { width: 104, align: 'right' });
    doc.y = y + 22;
  };
  head();
  for (const l of s.lines) {
    if (doc.y > doc.page.height - 90) {
      doc.addPage();
      head();
    }
    const y = doc.y;
    doc.font('r').fontSize(8.5).fillColor('#111').text(moscow(l.ts), cols[0] + 6, y, { width: 96 });
    doc.text(l.title, cols[1], y, { width: cols[2] - cols[1] - 10 });
    if (l.subtitle) doc.fontSize(7.5).fillColor('#777').text(l.subtitle, cols[1], doc.y, { width: cols[2] - cols[1] - 10 });
    const end = doc.y;
    doc.font('b').fontSize(8.5).fillColor(l.amount > 0 ? GREEN : '#111').text(`${l.amount > 0 ? '+' : '−'}${humanMoney(Math.abs(l.amount), s.currency)}`, cols[2], y, { width: 104, align: 'right' });
    doc.y = Math.max(end, doc.y) + 6;
    doc.moveTo(48, doc.y - 3).lineTo(48 + W, doc.y - 3).strokeColor('#eceeed').lineWidth(0.5).stroke();
  }
  if (!s.lines.length) doc.font('r').fontSize(9).fillColor('#777').text('Операций за период не было.', 54);
  doc.moveDown(2);
  doc.font('r').fontSize(8).fillColor('#888').text(`Выписка сформирована ${moscow(Date.now())}. Документ подписан простой электронной подписью ${BANK.legalName}.`, 48, doc.y, { width: W });
  return toBuffer(doc);
}

/** «Реквизиты для перевода» — what people send to employers and counterparties. */
export async function requisitesPdf(r: { holder: string; number: string; currency: string; accountName: string; inn?: string }): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 48, left: 48, right: 48 }, info: { Title: `Реквизиты счёта ${r.number}`, Author: BANK.legalName } });
  setup(doc);
  const W = doc.page.width - 96;
  header(doc, 48, 44);
  doc.moveDown(3);
  doc.font('b').fontSize(16).fillColor('#111').text('Реквизиты для перевода', 48);
  doc.font('r').fontSize(10).fillColor('#555').text(r.accountName);
  doc.moveDown(1.2);
  const rows: [string, string][] = [
    ['Получатель', r.holder],
    ...(r.inn ? [['ИНН получателя', r.inn] as [string, string]] : []),
    ['Номер счёта', r.number],
    ['Валюта', r.currency],
    ['Банк получателя', BANK.legalName],
    ['БИК', BANK.bik],
    ['Корр. счёт', CORR_ACCOUNT],
    ['ИНН банка', BANK.inn],
    ['КПП банка', BANK.kpp],
    ['Адрес банка', BANK.address],
  ];
  for (const [k, v] of rows) {
    const y = doc.y;
    doc.font('r').fontSize(10).fillColor('#777').text(k, 48, y, { width: 170 });
    doc.font('r').fontSize(11).fillColor('#111').text(v, 230, y, { width: W - 182 });
    doc.moveDown(0.6);
    doc.moveTo(48, doc.y - 4).lineTo(48 + W, doc.y - 4).strokeColor('#eceeed').lineWidth(0.5).stroke();
  }
  doc.moveDown(2);
  doc.font('r').fontSize(8).fillColor('#888').text(`Документ сформирован в приложении Bobobank ${moscow(Date.now())}.`, 48, doc.y, { width: W });
  return toBuffer(doc);
}
