import { HttpError, type Ctx } from '../context.js';
import { newId } from '../util.js';
import { lineByNumber, requireLine, type LineRow } from './lines.js';
import { formatNumber, normalize, SYSTEM_SENDER } from './numbers.js';

/** Nobody answered in 30 seconds: a missed call. */
const RING_MS = 30_000;
/** A call nobody hung up (closed tab) ends after an hour. */
const MAX_CALL_MS = 3600_000;

export interface CallRow {
  id: string;
  from_number: string;
  to_number: string;
  status: 'ringing' | 'active' | 'ended' | 'missed' | 'declined' | 'busy';
  created_at: number;
  answered_at: number | null;
  ended_at: number | null;
  seconds: number;
  billed_min: number;
}

/** First name and the initial of the surname of the owner: «Иван П.» — so people know whom they write to. */
export function subscriberName(ctx: Ctx, number: string): string | null {
  if (number === SYSTEM_SENDER) return 'Бобтелеком';
  const r = ctx.db.prepare(`SELECT u.name FROM lines l JOIN users u ON u.id = l.user_id WHERE l.number = ? AND l.status IN ('active', 'blocked')`).get(number) as { name: string } | undefined;
  if (!r) return null;
  const [first, last] = r.name.trim().split(/\s+/);
  return last ? `${first} ${last[0]}.` : first;
}

function peer(ctx: Ctx, raw: string, me: LineRow): LineRow {
  const n = normalize(raw);
  if (!n) throw new HttpError(400, 'Наберите номер полностью: +7 9XX XXX-XX-XX', 'bad_number');
  if (n === me.number) throw new HttpError(400, 'Это ваш номер', 'self');
  const l = lineByNumber(ctx, n);
  if (!l) throw new HttpError(404, 'Абонент не обслуживается Бобтелекомом. Звонить и писать можно только абонентам Бобтелекома.', 'not_subscriber');
  return l;
}

const assertActive = (me: LineRow) => {
  if (me.status !== 'active') throw new HttpError(409, 'Номер заблокирован — оплатите связь, чтобы звонить и писать', 'blocked');
};

// ---- SMS ----

export function sendSms(ctx: Ctx, userId: string, to: string, text: string) {
  const me = requireLine(ctx, userId);
  assertActive(me);
  const other = peer(ctx, to, me);
  if (me.sms_left === 0) throw new HttpError(402, 'SMS по тарифу закончились — подключите пакет «+100 SMS» или смените тариф', 'no_sms');
  const id = newId('msg', 16);
  ctx.db.transaction(() => {
    ctx.db.prepare('INSERT INTO messages(id, from_number, to_number, text, created_at) VALUES(?,?,?,?,?)').run(id, me.number, other.number, text, ctx.now());
    ctx.db.prepare('UPDATE lines SET sms_left = CASE WHEN sms_left < 0 THEN -1 ELSE sms_left - 1 END, sms_used = sms_used + 1 WHERE id = ?').run(me.id);
  })();
  return { id, from: me.number, to: other.number, text, createdAt: ctx.now(), mine: true };
}

interface MsgRow {
  id: string;
  from_number: string;
  to_number: string;
  text: string;
  created_at: number;
  read_at: number | null;
}

/** Conversations: the other number, its owner, the last message and unread count. */
export function chats(ctx: Ctx, userId: string) {
  const me = requireLine(ctx, userId);
  const rows = ctx.db
    .prepare(
      `SELECT CASE WHEN from_number = ? THEN to_number ELSE from_number END AS other, MAX(created_at) AS at,
              SUM(CASE WHEN to_number = ? AND read_at IS NULL THEN 1 ELSE 0 END) AS unread
       FROM messages WHERE (from_number = ? OR to_number = ?) AND created_at >= ? GROUP BY other ORDER BY at DESC LIMIT 100`,
    )
    .all(me.number, me.number, me.number, me.number, me.created_at) as { other: string; at: number; unread: number }[];
  return rows.map((r) => {
    const last = ctx.db
      .prepare('SELECT * FROM messages WHERE ((from_number = ? AND to_number = ?) OR (from_number = ? AND to_number = ?)) ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(me.number, r.other, r.other, me.number) as MsgRow;
    return { number: r.other, formatted: formatNumber(r.other), name: subscriberName(ctx, r.other), system: r.other === SYSTEM_SENDER, last: { text: last.text, mine: last.from_number === me.number, at: last.created_at }, unread: r.unread };
  });
}

export function conversation(ctx: Ctx, userId: string, otherRaw: string) {
  const me = requireLine(ctx, userId);
  const other = otherRaw === SYSTEM_SENDER ? SYSTEM_SENDER : normalize(otherRaw);
  if (!other) throw new HttpError(400, 'Неверный номер');
  const rows = ctx.db
    .prepare('SELECT * FROM messages WHERE ((from_number = ? AND to_number = ?) OR (from_number = ? AND to_number = ?)) AND created_at >= ? ORDER BY created_at, rowid LIMIT 500')
    .all(me.number, other, other, me.number, me.created_at) as MsgRow[];
  ctx.db.prepare('UPDATE messages SET read_at = ? WHERE to_number = ? AND from_number = ? AND read_at IS NULL').run(ctx.now(), me.number, other);
  return {
    number: other,
    formatted: formatNumber(other),
    name: subscriberName(ctx, other),
    system: other === SYSTEM_SENDER,
    messages: rows.map((m) => ({ id: m.id, text: m.text, mine: m.from_number === me.number, createdAt: m.created_at })),
  };
}

export const unreadCount = (ctx: Ctx, number: string) =>
  (ctx.db.prepare('SELECT COUNT(*) c FROM messages WHERE to_number = ? AND read_at IS NULL').get(number) as { c: number }).c;

// ---- Calls ----

const busy = (ctx: Ctx, n: string) => !!ctx.db.prepare(`SELECT 1 FROM calls WHERE status IN ('ringing', 'active') AND (from_number = ? OR to_number = ?)`).get(n, n);
const callById = (ctx: Ctx, id: string) => ctx.db.prepare('SELECT * FROM calls WHERE id = ?').get(id) as CallRow | undefined;

export function startCall(ctx: Ctx, userId: string, to: string) {
  const me = requireLine(ctx, userId);
  assertActive(me);
  const other = peer(ctx, to, me);
  if (me.minutes_left === 0) throw new HttpError(402, 'Минуты по тарифу закончились — подключите пакет «+300 минут» или смените тариф', 'no_minutes');
  if (busy(ctx, me.number)) throw new HttpError(409, 'Сначала завершите текущий звонок', 'in_call');
  const id = newId('call', 16);
  const status = busy(ctx, other.number) || other.status !== 'active' ? 'busy' : 'ringing';
  ctx.db.prepare('INSERT INTO calls(id, from_number, to_number, status, created_at, ended_at) VALUES(?,?,?,?,?,?)').run(id, me.number, other.number, status, ctx.now(), status === 'busy' ? ctx.now() : null);
  return callView(ctx, callById(ctx, id)!, me.number);
}

function mine(ctx: Ctx, userId: string, id: string) {
  const me = requireLine(ctx, userId);
  const c = callById(ctx, id);
  if (!c || (c.from_number !== me.number && c.to_number !== me.number)) throw new HttpError(404, 'Звонок не найден');
  return { me, c };
}

export function answerCall(ctx: Ctx, userId: string, id: string) {
  const { me, c } = mine(ctx, userId, id);
  if (c.to_number !== me.number || c.status !== 'ringing') throw new HttpError(409, 'Звонок уже завершён', 'bad_status');
  ctx.db.prepare(`UPDATE calls SET status = 'active', answered_at = ? WHERE id = ? AND status = 'ringing'`).run(ctx.now(), id);
  return callView(ctx, callById(ctx, id)!, me.number);
}

/** Hang up, decline or cancel. Only the caller pays: by the started minute of the conversation. */
export function endCall(ctx: Ctx, userId: string, id: string) {
  const { me, c } = mine(ctx, userId, id);
  finish(ctx, c, c.status === 'ringing' ? (c.to_number === me.number ? 'declined' : 'missed') : 'ended');
  return callView(ctx, callById(ctx, id)!, me.number);
}

function finish(ctx: Ctx, c: CallRow, status: CallRow['status'], at = ctx.now()) {
  if (c.status !== 'ringing' && c.status !== 'active') return;
  const seconds = c.answered_at ? Math.max(0, Math.round((at - c.answered_at) / 1000)) : 0;
  const billed = Math.ceil(seconds / 60);
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE calls SET status = ?, ended_at = ?, seconds = ?, billed_min = ? WHERE id = ? AND status IN (?, ?)').run(status, at, seconds, billed, c.id, 'ringing', 'active');
    if (billed)
      ctx.db
        .prepare(`UPDATE lines SET minutes_left = CASE WHEN minutes_left < 0 THEN -1 ELSE MAX(0, minutes_left - ?) END, minutes_used = minutes_used + ? WHERE number = ? AND status IN ('active', 'blocked')`)
        .run(billed, billed, c.from_number);
  })();
}

/** The call on the screen right now (incoming, outgoing or in progress), or the one that just ended. */
export function currentCall(ctx: Ctx, userId: string) {
  const me = requireLine(ctx, userId);
  const c = ctx.db
    .prepare(`SELECT * FROM calls WHERE (from_number = ? OR to_number = ?) AND (status IN ('ringing', 'active') OR ended_at > ?) ORDER BY created_at DESC LIMIT 1`)
    .get(me.number, me.number, ctx.now() - 4000) as CallRow | undefined;
  return c ? callView(ctx, c, me.number) : null;
}

export function callView(ctx: Ctx, c: CallRow, myNumber: string) {
  const outgoing = c.from_number === myNumber;
  const other = outgoing ? c.to_number : c.from_number;
  return {
    id: c.id,
    direction: outgoing ? ('out' as const) : ('in' as const),
    number: other,
    formatted: formatNumber(other),
    name: subscriberName(ctx, other),
    status: c.status,
    createdAt: c.created_at,
    answeredAt: c.answered_at,
    endedAt: c.ended_at,
    seconds: c.seconds,
    billedMin: outgoing ? c.billed_min : 0,
    now: ctx.now(),
  };
}

export function recentCalls(ctx: Ctx, userId: string) {
  const me = requireLine(ctx, userId);
  return (ctx.db.prepare('SELECT * FROM calls WHERE (from_number = ? OR to_number = ?) AND created_at >= ? ORDER BY created_at DESC LIMIT 100').all(me.number, me.number, me.created_at) as CallRow[]).map((c) => callView(ctx, c, me.number));
}

/** Unanswered calls become missed; calls end when the caller's minutes run out or after an hour. */
export function tickCalls(ctx: Ctx) {
  const now = ctx.now();
  for (const c of ctx.db.prepare(`SELECT * FROM calls WHERE status = 'ringing' AND created_at <= ?`).all(now - RING_MS) as CallRow[]) finish(ctx, c, 'missed', c.created_at + RING_MS);
  for (const c of ctx.db.prepare(`SELECT c.*, l.minutes_left FROM calls c JOIN lines l ON l.number = c.from_number AND l.status IN ('active', 'blocked') WHERE c.status = 'active'`).all() as (CallRow & { minutes_left: number })[]) {
    const limit = c.minutes_left < 0 ? MAX_CALL_MS : Math.min(MAX_CALL_MS, c.minutes_left * 60_000);
    if (now - c.answered_at! >= limit) finish(ctx, c, 'ended', c.answered_at! + limit);
  }
}
