import { HttpError, type Ctx } from '../context.js';
import { decrypt, newId, safeJson, sha256 } from '../util.js';
import { categoryOfMcc, type Category } from './bank.js';
import { accrueCashback, reverseCashback } from './bonus.js';
import { cardExpired, findCardByPan, getCard, monthSpent, serializeCard, type CardLimits, type CardRow } from './cards.js';
import { costIn, fxLegs, getFx } from './fx.js';
import {
  activeRestrictions, available, createHold, getAccount, isFullyBlocked, notify, post, releaseHold, systemAccount, type AccountRow,
} from './ledger.js';
import { humanMoney } from './money.js';
import { getUser } from './transfers.js';

/** Decline codes understood by GPAY (same as its game-card outcomes). */
export type DeclineReason = 'insufficient_funds' | 'card_expired' | 'general_decline' | 'invalid_csc' | 'card_blocked' | 'limit_exceeded';

export const CONFIRM_TTL_MS = 5 * 60_000;
export const HOLD_TTL_MS = 7 * 24 * 3600_000;

export interface Merchant {
  name: string;
  shopId?: number;
  mcc?: number;
  inn?: string;
  site?: string;
}

export interface AuthorizationRow {
  id: string;
  card_id: string;
  account_id: string;
  hold_id: string | null;
  external_id: string;
  amount: number;
  currency: string;
  account_amount: number;
  merchant: string;
  capture: number;
  status: 'pending' | 'approved' | 'captured' | 'declined' | 'expired' | 'voided';
  reason: string | null;
  captured: number;
  refunded: number;
  bonus: number;
  created_at: number;
  expires_at: number;
  decided_at: number | null;
}

export const getAuthorization = (ctx: Ctx, id: string) => ctx.db.prepare('SELECT * FROM authorizations WHERE id = ?').get(id) as AuthorizationRow | undefined;

export interface AuthorizeInput {
  pan: string;
  expMonth: number;
  expYear: number;
  cvc: string;
  amount: number;
  currency: string;
  merchant: Merchant;
  externalId: string;
  capture: boolean;
}

export type AuthorizeResult =
  | { status: 'approved' | 'captured'; authorization_id: string }
  | { status: 'pending'; authorization_id: string; expires_at: number }
  | { status: 'declined'; authorization_id?: string; reason: DeclineReason; message: string };

const decline = (reason: DeclineReason, message: string): AuthorizeResult => ({ status: 'declined', reason, message });

function check(ctx: Ctx, card: CardRow, acc: AccountRow, accountAmount: number): AuthorizeResult | null {
  const user = getUser(ctx, card.user_id);
  if (card.status === 'frozen') return decline('card_blocked', 'Карта временно заморожена владельцем в приложении Bobobank.');
  if (card.status === 'blocked') return decline('card_blocked', 'Карта заблокирована банком. Обратитесь в Bobobank.');
  if (card.status === 'closed') return decline('card_blocked', 'Карта закрыта.');
  if (!user || user.blocked) return decline('card_blocked', 'Операции по карте приостановлены банком.');
  if (cardExpired(card, ctx.now())) return decline('card_expired', 'Срок действия карты истёк. Оплатите другой картой.');
  const restricted = activeRestrictions(ctx, card.user_id).some((r) => (r.type === 'block_debit' || r.type === 'block_full') && (r.account_id === null || r.account_id === acc.id));
  if (restricted || isFullyBlocked(ctx, acc) || acc.status !== 'open') return decline('card_blocked', 'Операции по счёту карты ограничены банком.');
  const limits = safeJson<CardLimits>(card.limits, { monthly: 0, online: true });
  if (!limits.online) return decline('general_decline', 'Оплата в интернете отключена в настройках карты. Включите её в приложении Bobobank.');
  if (limits.monthly > 0 && monthSpent(ctx, card.id, ctx.now()) + accountAmount > limits.monthly) return decline('limit_exceeded', 'Превышен месячный лимит покупок по карте. Измените лимит в приложении Bobobank.');
  if (available(ctx, acc) < accountAmount) return decline('insufficient_funds', 'Недостаточно средств на карте. Пополните счёт или выберите другую карту.');
  return null;
}

/** Card payment request from GPAY. Purchases need confirmation in the app unless the customer turned it off. */
export function authorize(ctx: Ctx, input: AuthorizeInput): AuthorizeResult {
  const pan = input.pan.replace(/\D/g, '');
  const card = findCardByPan(ctx, pan);
  if (!card) return decline('general_decline', 'Карта не найдена в банке-эмитенте.');
  if (card.exp_month !== input.expMonth || card.exp_year !== input.expYear % 100) return decline('general_decline', 'Неверный срок действия карты. Проверьте месяц и год.');
  if (decrypt(ctx.secret, card.cvc_enc) !== input.cvc) return decline('invalid_csc', 'Неверный код CVC/CVV. Проверьте три цифры на обороте карты.');
  const acc = getAccount(ctx, card.account_id)!;
  const accountAmount = costIn(getFx(ctx.db), input.amount, input.currency, acc.currency);
  const bad = check(ctx, card, acc, accountAmount);
  if (bad) return bad;

  const id = newId('auth', 20);
  const now = ctx.now();
  const pending = !!card.confirm_purchases;
  ctx.db
    .prepare(
      `INSERT INTO authorizations(id, card_id, account_id, external_id, amount, currency, account_amount, merchant, capture, status, created_at, expires_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, card.id, acc.id, input.externalId, input.amount, input.currency, accountAmount, JSON.stringify(input.merchant), input.capture ? 1 : 0, 'pending', now, now + CONFIRM_TTL_MS);
  if (pending) {
    notify(ctx, card.user_id, 'purchase_confirm', `Подтвердите покупку на ${humanMoney(input.amount, input.currency)}`, `${input.merchant.name} · карта •• ${card.last4}`, { authorizationId: id });
    return { status: 'pending', authorization_id: id, expires_at: now + CONFIRM_TTL_MS };
  }
  return approve(ctx, getAuthorization(ctx, id)!);
}

function approve(ctx: Ctx, a: AuthorizationRow): AuthorizeResult {
  const card = getCard(ctx, a.card_id)!;
  const acc = getAccount(ctx, a.account_id)!;
  const bad = check(ctx, card, acc, a.account_amount);
  if (bad && bad.status === 'declined') {
    ctx.db.prepare(`UPDATE authorizations SET status = 'declined', reason = ?, decided_at = ? WHERE id = ?`).run(bad.reason, ctx.now(), a.id);
    return { ...bad, authorization_id: a.id };
  }
  const m = safeJson<Merchant>(a.merchant, { name: 'Магазин' });
  const holdId = createHold(ctx, acc, a.account_amount, m.name, categoryOfMcc(m.mcc), HOLD_TTL_MS, card.id);
  ctx.db.prepare(`UPDATE authorizations SET status = 'approved', hold_id = ?, decided_at = ?, expires_at = ? WHERE id = ?`).run(holdId, ctx.now(), ctx.now() + HOLD_TTL_MS, a.id);
  if (a.capture) {
    capture(ctx, a.id, a.amount);
    return { status: 'captured', authorization_id: a.id };
  }
  return { status: 'approved', authorization_id: a.id };
}

/** The customer's answer in the app. */
export function decide(ctx: Ctx, userId: string, id: string, ok: boolean): AuthorizeResult {
  const a = getAuthorization(ctx, id);
  if (!a || getCard(ctx, a.card_id)?.user_id !== userId) throw new HttpError(404, 'Запрос не найден');
  if (a.status !== 'pending') throw new HttpError(400, 'Запрос уже обработан');
  if (a.expires_at < ctx.now()) throw new HttpError(400, 'Время на подтверждение истекло');
  if (!ok) {
    ctx.db.prepare(`UPDATE authorizations SET status = 'declined', reason = 'declined_by_customer', decided_at = ? WHERE id = ?`).run(ctx.now(), a.id);
    return { status: 'declined', authorization_id: a.id, reason: 'general_decline', message: 'Покупка отклонена владельцем карты в приложении банка.' };
  }
  return approve(ctx, a);
}

export function capture(ctx: Ctx, id: string, amount: number) {
  const a = getAuthorization(ctx, id);
  if (!a) throw new HttpError(404, 'Авторизация не найдена');
  if (a.status === 'captured') return a;
  if (a.status !== 'approved' || !a.hold_id) throw new HttpError(400, `Нельзя списать: статус ${a.status}`);
  if (amount <= 0 || amount > a.amount) throw new HttpError(400, 'Сумма списания больше авторизованной');
  const card = getCard(ctx, a.card_id)!;
  const acc = getAccount(ctx, a.account_id)!;
  const m = safeJson<Merchant>(a.merchant, { name: 'Магазин' });
  const category: Category = categoryOfMcc(m.mcc);
  const accAmount = amount === a.amount ? a.account_amount : Math.ceil((a.account_amount * amount) / a.amount);
  const subtitle = acc.currency === a.currency ? `Покупка · карта •• ${card.last4}` : `Покупка ${humanMoney(amount, a.currency)} · карта •• ${card.last4}`;
  ctx.db.transaction(() => {
    post(ctx, {
      kind: 'purchase',
      description: `Покупка в ${m.name}`,
      holdId: a.hold_id!,
      meta: { authorizationId: a.id, externalId: a.external_id, merchant: m },
      legs: [
        { account: acc, amount: -accAmount, title: m.name, subtitle, category, cardId: card.id },
        ...fxLegs(ctx, acc.currency, accAmount, a.currency, amount),
        { account: systemAccount(ctx, 'gpay', a.currency), amount },
      ],
    });
    ctx.db.prepare(`UPDATE authorizations SET status = 'captured', captured = ?, account_amount = ? WHERE id = ?`).run(amount, accAmount, a.id);
    const rub = acc.currency === 'RUB' ? accAmount : costIn(getFx(ctx.db), accAmount, acc.currency, 'RUB');
    const pts = accrueCashback(ctx, card.user_id, rub, category, m.name);
    ctx.db.prepare('UPDATE authorizations SET bonus = ? WHERE id = ?').run(pts, a.id);
  })();
  return getAuthorization(ctx, id)!;
}

export function voidAuthorization(ctx: Ctx, id: string) {
  const a = getAuthorization(ctx, id);
  if (!a) throw new HttpError(404, 'Авторизация не найдена');
  if (a.status === 'voided' || a.status === 'declined' || a.status === 'expired') return a;
  if (a.status === 'captured') throw new HttpError(400, 'Платёж уже списан — используйте возврат');
  if (a.hold_id) releaseHold(ctx, a.hold_id);
  ctx.db.prepare(`UPDATE authorizations SET status = 'voided', decided_at = ? WHERE id = ?`).run(ctx.now(), a.id);
  return getAuthorization(ctx, id)!;
}

/** Refund from GPAY back to the card account (at the original conversion, so the customer loses nothing on FX). */
export function refund(ctx: Ctx, id: string, amount: number, refundId: string) {
  const a = getAuthorization(ctx, id);
  if (!a || a.status !== 'captured') throw new HttpError(400, 'Возврат возможен только по списанной покупке');
  if (a.refunded + amount > a.captured) throw new HttpError(400, 'Сумма возврата больше суммы покупки');
  const card = getCard(ctx, a.card_id)!;
  const acc = getAccount(ctx, a.account_id)!;
  const m = safeJson<Merchant>(a.merchant, { name: 'Магазин' });
  const accAmount = a.refunded + amount === a.captured ? a.account_amount - Math.floor((a.account_amount * a.refunded) / a.captured) : Math.floor((a.account_amount * amount) / a.captured);
  ctx.db.transaction(() => {
    post(ctx, {
      kind: 'refund',
      description: `Возврат от ${m.name}`,
      meta: { authorizationId: a.id, refundId },
      legs: [
        { account: systemAccount(ctx, 'gpay', a.currency), amount: -amount },
        ...fxLegs(ctx, a.currency, amount, acc.currency, accAmount),
        { account: acc, amount: accAmount, title: m.name, subtitle: `Возврат покупки · карта •• ${card.last4}`, category: categoryOfMcc(m.mcc), cardId: card.id },
      ],
    });
    ctx.db.prepare('UPDATE authorizations SET refunded = refunded + ? WHERE id = ?').run(amount, a.id);
    reverseCashback(ctx, card.user_id, Math.floor((a.bonus * amount) / a.captured), m.name);
  })();
  notify(ctx, card.user_id, 'refund', `Возврат ${humanMoney(accAmount, acc.currency)}`, `${m.name} вернул деньги на карту •• ${card.last4}`);
  return getAuthorization(ctx, id)!;
}

export function serializeAuthorization(ctx: Ctx, a: AuthorizationRow) {
  const card = getCard(ctx, a.card_id);
  return {
    id: a.id,
    status: a.status,
    reason: a.reason,
    amount: a.amount,
    currency: a.currency,
    accountAmount: a.account_amount,
    merchant: safeJson<Merchant>(a.merchant, { name: 'Магазин' }),
    card: card ? serializeCard(ctx, card) : null,
    createdAt: a.created_at,
    expiresAt: a.expires_at,
  };
}

export function pendingConfirmations(ctx: Ctx, userId: string) {
  const rows = ctx.db
    .prepare(`SELECT a.* FROM authorizations a JOIN cards c ON c.id = a.card_id WHERE c.user_id = ? AND a.status = 'pending' AND a.expires_at > ? ORDER BY a.created_at`)
    .all(userId, ctx.now()) as AuthorizationRow[];
  return rows.map((a) => serializeAuthorization(ctx, a));
}

/** SHA-256 of every usable card number: GPAY's checkout lets through only numbers from this list. */
export function cardHashes(ctx: Ctx): string[] {
  return (ctx.db.prepare(`SELECT pan_hash FROM cards WHERE status != 'closed'`).all() as { pan_hash: string }[]).map((r) => r.pan_hash);
}

export const isBankCardHash = (ctx: Ctx, pan: string) => !!ctx.db.prepare('SELECT 1 FROM cards WHERE pan_hash = ?').get(sha256(pan));
