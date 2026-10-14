import argon2 from 'argon2';
import { HttpError, type Ctx, type Role } from '../context.js';
import { newId } from '../util.js';
import { issueCard } from './cards.js';
import { notify, openAccount } from './ledger.js';

export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });

/** New customer: a RUB current account and a free virtual МИР card come with it. */
export async function createUser(ctx: Ctx, phone: string, name: string, password: string, opts: { birthDate?: string; role?: Role } = {}) {
  if (ctx.db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) throw new HttpError(409, 'Этот номер уже зарегистрирован. Войдите по паролю.');
  const id = newId('usr', 16);
  const role = opts.role ?? 'client';
  ctx.db
    .prepare('INSERT INTO users(id, phone, name, birth_date, pass_hash, role, created_at) VALUES(?,?,?,?,?,?,?)')
    .run(id, phone, name, opts.birthDate ?? '', await hashPassword(password), role, ctx.now());
  if (role === 'client') {
    const acc = openAccount(ctx, id, 'current', 'RUB', 'Платёжный счёт');
    issueCard(ctx, { userId: id, account: acc, network: 'mir', kind: 'debit', form: 'virtual', tariff: 'standard', design: 'green', holder: name });
    notify(ctx, id, 'welcome', 'Добро пожаловать в Bobobank!', 'Мы открыли вам счёт и выпустили виртуальную карту МИР. Ей можно платить в интернете уже сейчас.');
  }
  return id;
}
