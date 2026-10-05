import { audit, type Ctx } from '../context.js';
import { getSetting, setSetting } from '../db.js';
import { getRow, insertRecord, listRecords, toRec, updateRecordData, type Rec } from '../routes/records.js';
import { storeFile } from '../routes/files.js';
import { clientEventSchema, clientSchema, taskSchema } from '../schemas.js';
import { sha256 } from '../crypto.js';
import { esc, getTgToken, TgApi, TgError, type Keyboard, type TgCallback, type TgMessage, type TgUpdate } from './api.js';
import { checkIn, fmtDay, getCheckin, mskDay, mskTime } from './checkins.js';

export interface BotUser {
  id: string;
  login: string;
  fullName: string;
}

type ChatState =
  | { kind: 'search' }
  | { kind: 'newClient' }
  | { kind: 'edit'; clientId: string; field: string }
  | { kind: 'event'; clientId: string; eventKind: string }
  | { kind: 'editEvent'; eventId: string }
  | { kind: 'photo'; clientId: string };

const STATE_TTL_MS = 15 * 60 * 1000;
const OFFSET_KEY = 'tg_offset';

export const COMMANDS = [
  { command: 'menu', description: 'Главное меню' },
  { command: 'checkin', description: 'Отметиться за сегодня' },
  { command: 'clients', description: 'Найти клиента' },
  { command: 'newclient', description: 'Новый клиент' },
  { command: 'tasks', description: 'Мои задачи' },
  { command: 'routes', description: 'Мои выезды на сегодня' },
  { command: 'cancel', description: 'Отменить ввод' },
];

const STATUS: Record<string, string> = { new: 'Новый', active: 'Активный', paused: 'Пауза', former: 'Бывший' };
const EVENT_KIND: Record<string, string> = { call: '📞 Звонок', meeting: '🤝 Встреча', visit: '🚗 Выезд', note: '📝 Заметка' };
const ROUTE_STATUS: Record<string, string> = { planned: 'запланирован', in_progress: 'в пути', done: 'выполнен', cancelled: 'отменён' };

type ClientData = Record<string, unknown> & {
  fullName: string;
  phones: string[];
  emails: string[];
  tags: string[];
  messengers: Record<string, string>;
};

const splitList = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Client fields editable from the bot. "-" clears a field. */
const FIELDS: Record<string, { label: string; hint?: string; apply: (d: ClientData, text: string) => void }> = {
  fn: { label: 'ФИО', apply: (d, t) => void (d.fullName = t) },
  ph: { label: 'Телефоны', hint: 'через запятую', apply: (d, t) => void (d.phones = splitList(t)) },
  em: { label: 'Email', hint: 'через запятую', apply: (d, t) => void (d.emails = splitList(t)) },
  ad: { label: 'Адрес', apply: (d, t) => void (d.address = t) },
  loc: { label: 'Координаты', hint: 'отправьте геопозицию 📎 или «55.75, 37.62»', apply: () => {} },
  tf: { label: 'Тариф', apply: (d, t) => void (d.tariff = t) },
  mt: { label: 'Telegram', apply: (d, t) => void (d.messengers = { ...d.messengers, telegram: t }) },
  mw: { label: 'WhatsApp', apply: (d, t) => void (d.messengers = { ...d.messengers, whatsapp: t }) },
  ms: { label: 'Signal', apply: (d, t) => void (d.messengers = { ...d.messengers, signal: t }) },
  tag: { label: 'Теги', hint: 'через запятую', apply: (d, t) => void (d.tags = splitList(t)) },
  bd: { label: 'Дата рождения', hint: 'ГГГГ-ММ-ДД', apply: (d, t) => void (d.birthDate = t) },
  nt: { label: 'Заметки', hint: 'текст целиком заменит старые заметки', apply: (d, t) => void (d.notes = t) },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms).unref());

function short(s: unknown, n: number) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export class TelegramBot {
  private states = new Map<number, { state: ChatState; expires: number }>();
  private stopped = false;
  private abort: AbortController | null = null;
  private offset = 0;
  private tokenInUse: string | null = null;
  status = { running: false, lastPollAt: null as number | null, lastError: null as string | null };

  constructor(private ctx: Ctx, private log: (msg: string) => void = () => {}) {}

  // ---------- polling ----------

  start() {
    void this.loop();
  }

  stop() {
    this.stopped = true;
    this.abort?.abort();
  }

  private async loop() {
    while (!this.stopped) {
      const token = getTgToken(this.ctx);
      if (!token) {
        this.status.running = false;
        this.tokenInUse = null;
        await sleep(10_000);
        continue;
      }
      const api = new TgApi(this.ctx, token);
      try {
        if (token !== this.tokenInUse) {
          // Long polling and a webhook are mutually exclusive.
          await api.call('deleteWebhook');
          await api.call('setMyCommands', { commands: COMMANDS });
          this.offset = Number(getSetting(this.ctx.db, OFFSET_KEY) ?? 0);
          this.tokenInUse = token;
        }
        this.abort = new AbortController();
        const updates = await api.call<TgUpdate[]>(
          'getUpdates',
          { offset: this.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] },
          40_000,
          this.abort.signal,
        );
        this.status.running = true;
        this.status.lastPollAt = this.ctx.now();
        this.status.lastError = null;
        for (const u of updates) {
          this.offset = u.update_id + 1;
          try {
            await this.handleUpdate(u, api);
          } catch (err) {
            this.log(`Telegram: ошибка обработки: ${(err as Error).message}`);
          }
        }
        if (updates.length) setSetting(this.ctx.db, OFFSET_KEY, String(this.offset));
      } catch (err) {
        if (this.stopped) break;
        this.status.running = false;
        this.status.lastError = (err as Error).message;
        this.log(`Telegram: ${(err as Error).message}`);
        // 401: bad token — wait until it is replaced; 409: another poller — back off.
        await sleep(err instanceof TgError && (err.code === 401 || err.code === 409) ? 60_000 : 10_000);
      }
    }
  }

  // ---------- state ----------

  private getState(chatId: number): ChatState | null {
    const s = this.states.get(chatId);
    if (!s || s.expires < this.ctx.now()) return null;
    return s.state;
  }

  private setState(chatId: number, state: ChatState | null) {
    if (state) this.states.set(chatId, { state, expires: this.ctx.now() + STATE_TTL_MS });
    else this.states.delete(chatId);
  }

  linkedUser(tgId: number): BotUser | null {
    const row = this.ctx.db
      .prepare('SELECT u.id, u.login, u.data FROM tg_links l JOIN users u ON u.id = l.user_id WHERE l.tg_id = ? AND u.deleted_at IS NULL')
      .get(tgId) as { id: string; login: string; data: string } | undefined;
    if (!row) return null;
    const d = JSON.parse(row.data);
    if (d.status === 'fired') return null;
    return { id: row.id, login: row.login, fullName: d.fullName ?? row.login };
  }

  private audit(user: BotUser, action: Parameters<typeof audit>[2], entity: string, id: string | null, summary: string) {
    audit(this.ctx, null, action, entity, id, `${summary} (Telegram)`, { id: user.id, login: user.login });
  }

  // ---------- dispatch ----------

  async handleUpdate(u: TgUpdate, api?: TgApi) {
    if (!api) {
      const token = getTgToken(this.ctx);
      if (!token) return;
      api = new TgApi(this.ctx, token);
    }
    if (u.callback_query) return this.onCallback(api, u.callback_query);
    if (u.message) return this.onMessage(api, u.message);
  }

  private async onMessage(api: TgApi, m: TgMessage) {
    if (m.chat.type !== 'private' || !m.from) return;
    const chatId = m.chat.id;
    const text = (m.text ?? '').trim();
    const cmd = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);

    if (cmd && cmd[1]!.toLowerCase() === 'start' && cmd[2]) return this.link(api, m, cmd[2].trim());

    const user = this.linkedUser(m.from.id);
    if (!user) {
      return api.send(
        chatId,
        'Это бот портала ZhukoNet. Чтобы пользоваться им, привяжите аккаунт: на портале откройте <b>Отметки → Мой Telegram</b> и нажмите «Привязать».',
      );
    }

    if (cmd) {
      this.setState(chatId, null);
      const arg = cmd[2]?.trim() ?? '';
      switch (cmd[1]!.toLowerCase()) {
        case 'start':
        case 'menu':
        case 'help':
          return this.menu(api, chatId, user);
        case 'checkin':
          return this.checkin(api, chatId, user);
        case 'clients':
          return arg ? this.search(api, chatId, arg) : this.askSearch(api, chatId);
        case 'newclient':
          this.setState(chatId, { kind: 'newClient' });
          return api.send(chatId, 'Введите ФИО нового клиента:', [[{ text: 'Отмена', callback_data: 'x' }]]);
        case 'tasks':
          return this.tasks(api, chatId, user);
        case 'routes':
          return this.routes(api, chatId, user);
        case 'cancel':
          return api.send(chatId, 'Отменено.', [[{ text: '« Меню', callback_data: 'menu' }]]);
        default:
          return api.send(chatId, 'Неизвестная команда. /menu — главное меню.');
      }
    }

    const state = this.getState(chatId);

    if (m.photo || m.document) {
      if (state?.kind !== 'photo') return api.send(chatId, 'Чтобы прикрепить фото, откройте клиента и нажмите «📷 Фото».');
      return this.savePhoto(api, chatId, user, state.clientId, m);
    }

    if (m.location) {
      if (state?.kind === 'edit' && state.field === 'loc') return this.setLocation(api, chatId, user, state.clientId, m.location.latitude, m.location.longitude);
      return api.send(chatId, 'Геопозицию можно задать клиенту: карточка → ✏️ Изменить → Координаты.');
    }

    if (!text) return;
    switch (state?.kind) {
      case 'newClient':
        return this.createClient(api, chatId, user, text);
      case 'edit':
        return this.applyEdit(api, chatId, user, state.clientId, state.field, text);
      case 'event':
        return this.addEvent(api, chatId, user, state.clientId, state.eventKind, text);
      case 'editEvent':
        return this.editEvent(api, chatId, user, state.eventId, text);
      default:
        // Any plain text is a client search.
        return this.search(api, chatId, text);
    }
  }

  private async onCallback(api: TgApi, q: TgCallback) {
    const answer = (text?: string) => api.call('answerCallbackQuery', { callback_query_id: q.id, ...(text ? { text } : {}) }).catch(() => {});
    const m = q.message;
    if (!m || m.chat.type !== 'private') return answer();
    const user = this.linkedUser(q.from.id);
    if (!user) return answer('Аккаунт не привязан');
    await answer();

    const chatId = m.chat.id;
    const [action, a = '', b = ''] = (q.data ?? '').split(':');
    const nav = (text: string, kb?: Keyboard) => api.edit(chatId, m.message_id, text, kb);

    switch (action) {
      case 'menu':
        this.setState(chatId, null);
        return nav(this.menuText(user), this.menuKeyboard());
      case 'x':
        this.setState(chatId, null);
        return nav('Отменено.', [[{ text: '« Меню', callback_data: 'menu' }]]);
      case 'ci':
        return this.checkin(api, chatId, user);
      case 'cl':
        return this.askSearch(api, chatId);
      case 'nc':
        this.setState(chatId, { kind: 'newClient' });
        return api.send(chatId, 'Введите ФИО нового клиента:', [[{ text: 'Отмена', callback_data: 'x' }]]);
      case 'tk':
        return this.tasks(api, chatId, user);
      case 'rt':
        return this.routes(api, chatId, user);
      case 'c':
        this.setState(chatId, null);
        return this.showClient(api, chatId, a, m.message_id);
      case 'ce': {
        const c = this.client(a);
        if (!c) return api.send(chatId, 'Клиент не найден.');
        const keys = Object.entries(FIELDS).map(([k, f]) => ({ text: f.label, callback_data: `cf:${a}:${k}` }));
        const rows: Keyboard = [];
        for (let i = 0; i < keys.length; i += 3) rows.push(keys.slice(i, i + 3));
        rows.push(Object.entries(STATUS).map(([k, l]) => ({ text: (c.status === k ? '● ' : '') + l, callback_data: `cs:${a}:${k}` })));
        rows.push([{ text: '« К клиенту', callback_data: `c:${a}` }]);
        return nav(`✏️ <b>${esc(c.fullName)}</b>\nЧто изменить? Нижний ряд — статус.`, rows);
      }
      case 'cf': {
        const f = FIELDS[b];
        const c = this.client(a);
        if (!f || !c) return api.send(chatId, 'Клиент не найден.');
        this.setState(chatId, { kind: 'edit', clientId: a, field: b });
        return api.send(
          chatId,
          `Новое значение поля «${f.label}» для <b>${esc(c.fullName)}</b>${f.hint ? ` (${f.hint})` : ''}.\nОтправьте «-», чтобы очистить.`,
          [[{ text: 'Отмена', callback_data: `c:${a}` }]],
        );
      }
      case 'cs':
        return this.setStatus(api, chatId, user, a, b, m.message_id);
      case 'h':
        return this.history(api, chatId, a, m.message_id);
      case 'ha':
        return nav('Тип записи:', [
          Object.entries(EVENT_KIND).map(([k, l]) => ({ text: l, callback_data: `hk:${a}:${k}` })),
          [{ text: '« К клиенту', callback_data: `c:${a}` }],
        ]);
      case 'hk':
        if (!EVENT_KIND[b] || !this.client(a)) return;
        this.setState(chatId, { kind: 'event', clientId: a, eventKind: b });
        return api.send(chatId, `${EVENT_KIND[b]}: напишите текст записи.`, [[{ text: 'Отмена', callback_data: `c:${a}` }]]);
      case 'e':
        return this.showEvent(api, chatId, a, m.message_id);
      case 'ee': {
        const ev = this.event(a);
        if (!ev) return api.send(chatId, 'Запись не найдена.');
        this.setState(chatId, { kind: 'editEvent', eventId: a });
        return api.send(chatId, `Текущий текст:\n<i>${esc(short(ev.text, 1500))}</i>\n\nОтправьте новый текст записи.`, [[{ text: 'Отмена', callback_data: `e:${a}` }]]);
      }
      case 'ed':
        return nav('Удалить запись истории? Её можно будет восстановить из корзины на портале в течение 30 дней.', [
          [
            { text: '🗑 Да, удалить', callback_data: `edy:${a}` },
            { text: 'Нет', callback_data: `e:${a}` },
          ],
        ]);
      case 'edy':
        return this.deleteEvent(api, chatId, user, a, m.message_id);
      case 'cp': {
        const c = this.client(a);
        if (!c) return api.send(chatId, 'Клиент не найден.');
        this.setState(chatId, { kind: 'photo', clientId: a });
        return api.send(chatId, `📷 Отправьте фото для <b>${esc(c.fullName)}</b> (можно несколько, подпись станет описанием).`, [[{ text: 'Готово', callback_data: `c:${a}` }]]);
      }
      case 'td':
        return this.completeTask(api, chatId, user, a, m.message_id);
    }
  }

  // ---------- linking & menu ----------

  private async link(api: TgApi, m: TgMessage, code: string) {
    const row = this.ctx.db.prepare('SELECT user_id, expires_at FROM tg_link_codes WHERE code_hash = ?').get(sha256(code)) as
      | { user_id: string; expires_at: number }
      | undefined;
    if (!row || row.expires_at < this.ctx.now()) {
      return api.send(m.chat.id, 'Ссылка для привязки недействительна или устарела. Создайте новую на портале: <b>Отметки → Мой Telegram</b>.');
    }
    const tgId = m.from!.id;
    this.ctx.db.transaction(() => {
      this.ctx.db.prepare('DELETE FROM tg_link_codes WHERE user_id = ?').run(row.user_id);
      this.ctx.db.prepare('DELETE FROM tg_links WHERE tg_id = ? OR user_id = ?').run(tgId, row.user_id);
      this.ctx.db.prepare('INSERT INTO tg_links(tg_id, user_id, username, linked_at) VALUES(?,?,?,?)').run(tgId, row.user_id, m.from!.username ?? null, this.ctx.now());
    })();
    const user = this.linkedUser(tgId);
    if (!user) return api.send(m.chat.id, 'Аккаунт заблокирован.');
    this.audit(user, 'tg_link', 'employee', user.id, `Telegram привязан${m.from!.username ? ` (@${m.from!.username})` : ''}`);
    await api.send(m.chat.id, `✅ Telegram привязан к аккаунту <b>${esc(user.fullName)}</b> (${esc(user.login)}).`);
    return this.menu(api, m.chat.id, user);
  }

  private menuText(user: BotUser) {
    const today = mskDay(this.ctx.now());
    const ci = getCheckin(this.ctx, user.id, today);
    return (
      `<b>ZhukoNet</b> · ${esc(user.fullName)}\n` +
      (ci ? `✅ Сегодня отмечен(а) в ${mskTime(ci.ts)} МСК` : `⚠️ Сегодня (${fmtDay(today)}) вы ещё не отметились — до 00:00 МСК.`) +
      `\n\nЧтобы найти клиента, просто напишите имя, телефон или email.`
    );
  }

  private menuKeyboard(): Keyboard {
    return [
      [{ text: '✅ Отметиться', callback_data: 'ci' }],
      [
        { text: '🔎 Клиенты', callback_data: 'cl' },
        { text: '➕ Новый клиент', callback_data: 'nc' },
      ],
      [
        { text: '📋 Мои задачи', callback_data: 'tk' },
        { text: '🗺 Выезды сегодня', callback_data: 'rt' },
      ],
    ];
  }

  private menu(api: TgApi, chatId: number, user: BotUser) {
    return api.send(chatId, this.menuText(user), this.menuKeyboard());
  }

  private async checkin(api: TgApi, chatId: number, user: BotUser) {
    const r = checkIn(this.ctx, user.id, 'telegram');
    if (!r.already) this.audit(user, 'checkin', 'employee', user.id, `Отметка за ${fmtDay(r.day)}`);
    return api.send(
      chatId,
      r.already ? `Вы уже отметились сегодня в ${mskTime(r.ts)} МСК.` : `✅ Отмечено: ${fmtDay(r.day)}, ${mskTime(r.ts)} МСК.`,
      [[{ text: '« Меню', callback_data: 'menu' }]],
    );
  }

  // ---------- clients ----------

  private client(id: string): ClientData | null {
    const row = getRow(this.ctx, 'client', id);
    return row ? (JSON.parse(row.data) as ClientData) : null;
  }

  private event(id: string): Rec | null {
    const row = getRow(this.ctx, 'client_event', id);
    return row ? toRec(row) : null;
  }

  private employeeName(id: unknown) {
    if (!id) return '—';
    const row = this.ctx.db.prepare('SELECT login, data FROM users WHERE id = ?').get(id) as { login: string; data: string } | undefined;
    return row ? (JSON.parse(row.data).fullName ?? row.login) : '—';
  }

  private askSearch(api: TgApi, chatId: number) {
    this.setState(chatId, { kind: 'search' });
    return api.send(chatId, '🔎 Напишите имя, телефон, email или тег клиента.');
  }

  private async search(api: TgApi, chatId: number, q: string) {
    const needle = q.toLowerCase();
    const digits = q.replace(/\D/g, '');
    const all = listRecords(this.ctx, 'client');
    const found = all.filter((c) => {
      const d = c as unknown as ClientData;
      const hay = [d.fullName, d.address, d.tariff, ...(d.emails ?? []), ...(d.tags ?? []), ...Object.values(d.messengers ?? {})].join(' ').toLowerCase();
      if (hay.includes(needle)) return true;
      return digits.length >= 4 && (d.phones ?? []).some((p) => p.replace(/\D/g, '').includes(digits));
    });
    if (!found.length) {
      return api.send(chatId, `Клиентов по запросу «${esc(short(q, 50))}» не найдено.`, [
        [
          { text: '➕ Новый клиент', callback_data: 'nc' },
          { text: '« Меню', callback_data: 'menu' },
        ],
      ]);
    }
    const kb: Keyboard = found.slice(0, 15).map((c) => [{ text: `${c.fullName}${STATUS[c.status as string] ? ` · ${STATUS[c.status as string]}` : ''}`, callback_data: `c:${c.id}` }]);
    kb.push([{ text: '« Меню', callback_data: 'menu' }]);
    return api.send(chatId, `Найдено: ${found.length}${found.length > 15 ? ' (показаны первые 15, уточните запрос)' : ''}`, kb);
  }

  private clientCard(id: string): { text: string; kb: Keyboard } | null {
    const c = this.client(id);
    if (!c) return null;
    const lines = [`👤 <b>${esc(c.fullName)}</b>`, `Статус: ${STATUS[c.status as string] ?? c.status} · Ответственный: ${esc(this.employeeName(c.responsibleId))}`];
    if (c.phones?.length) lines.push(`📞 ${c.phones.map(esc).join(', ')}`);
    if (c.emails?.length) lines.push(`✉️ ${c.emails.map(esc).join(', ')}`);
    const ms = c.messengers ?? {};
    const msg = [ms.telegram && `TG: ${esc(ms.telegram)}`, ms.whatsapp && `WA: ${esc(ms.whatsapp)}`, ms.signal && `Signal: ${esc(ms.signal)}`].filter(Boolean);
    if (msg.length) lines.push(`💬 ${msg.join(' · ')}`);
    if (c.address) lines.push(`📍 ${esc(c.address)}`);
    if (c.lat != null && c.lng != null) lines.push(`🌐 <a href="https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lng}#map=17/${c.lat}/${c.lng}">${c.lat}, ${c.lng}</a>`);
    if (c.birthDate) lines.push(`🎂 ${esc(c.birthDate)}`);
    if (c.tariff) lines.push(`💳 Тариф: ${esc(c.tariff)}`);
    if (c.tags?.length) lines.push(`🏷 ${c.tags.map(esc).join(', ')}`);
    const infra = (c.infra as unknown[] | undefined)?.length ?? 0;
    if (infra) lines.push(`🖧 Устройств в инфраструктуре: ${infra}`);
    if (c.notes) lines.push('', `📝 ${esc(short(c.notes, 800))}`);
    const events = this.events(id).slice(0, 3);
    if (events.length) {
      lines.push('', '<b>Последние записи:</b>');
      for (const e of events) lines.push(`• ${esc(e.date)} ${EVENT_KIND[e.kind as string] ?? ''} — ${esc(short(e.text, 120))}`);
    }
    return {
      text: lines.join('\n'),
      kb: [
        [
          { text: '✏️ Изменить', callback_data: `ce:${id}` },
          { text: '📜 История', callback_data: `h:${id}` },
        ],
        [
          { text: '📝 Запись в историю', callback_data: `ha:${id}` },
          { text: '📷 Фото', callback_data: `cp:${id}` },
        ],
        [{ text: '« Меню', callback_data: 'menu' }],
      ],
    };
  }

  private showClient(api: TgApi, chatId: number, id: string, editMessageId?: number) {
    const card = this.clientCard(id);
    if (!card) return api.send(chatId, 'Клиент не найден (возможно, удалён).');
    return editMessageId ? api.edit(chatId, editMessageId, card.text, card.kb) : api.send(chatId, card.text, card.kb);
  }

  private events(clientId: string): Rec[] {
    return listRecords(this.ctx, 'client_event', { clientId }).sort(
      (a, b) => String(b.date).localeCompare(String(a.date)) || (b.createdAt as number) - (a.createdAt as number),
    );
  }

  private saveClient(user: BotUser, id: string, data: ClientData, what: string) {
    const parsed = clientSchema.parse(data);
    updateRecordData(this.ctx, id, parsed, user.id);
    this.audit(user, 'update', 'client', id, `${parsed.fullName}: ${what}`);
  }

  private async createClient(api: TgApi, chatId: number, user: BotUser, name: string) {
    const parsed = clientSchema.safeParse({ fullName: name, responsibleId: user.id });
    if (!parsed.success) return api.send(chatId, `Ошибка: ${esc(parsed.error.issues[0]?.message)}`);
    const rec = insertRecord(this.ctx, 'client', parsed.data, user.id);
    this.audit(user, 'create', 'client', rec.id, parsed.data.fullName);
    this.setState(chatId, null);
    await api.send(chatId, '✅ Клиент создан. Заполните остальные данные кнопкой «✏️ Изменить».');
    return this.showClient(api, chatId, rec.id);
  }

  private async applyEdit(api: TgApi, chatId: number, user: BotUser, clientId: string, field: string, text: string) {
    const f = FIELDS[field];
    const c = this.client(clientId);
    if (!f || !c) return api.send(chatId, 'Клиент не найден.');
    const value = text === '-' ? '' : text;
    if (field === 'loc') {
      if (!value) return this.setLocation(api, chatId, user, clientId, null, null);
      const m = /^(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)$/.exec(value);
      if (!m) return api.send(chatId, 'Не понял координаты. Пример: <code>55.7558, 37.6173</code> — или отправьте геопозицию.');
      return this.setLocation(api, chatId, user, clientId, Number(m[1]), Number(m[2]));
    }
    if (field === 'fn' && !value) return api.send(chatId, 'ФИО не может быть пустым.');
    f.apply(c, value);
    try {
      this.saveClient(user, clientId, c, f.label);
    } catch (err) {
      const issue = (err as { issues?: { path: unknown[]; message: string }[] }).issues?.[0];
      return api.send(chatId, `Ошибка: ${esc(issue ? `${issue.path.join('.')}: ${issue.message}` : (err as Error).message)}`);
    }
    this.setState(chatId, null);
    await api.send(chatId, `✅ ${f.label}: сохранено.`);
    return this.showClient(api, chatId, clientId);
  }

  private async setLocation(api: TgApi, chatId: number, user: BotUser, clientId: string, lat: number | null, lng: number | null) {
    const c = this.client(clientId);
    if (!c) return api.send(chatId, 'Клиент не найден.');
    c.lat = lat === null ? null : Math.round(lat * 1e6) / 1e6;
    c.lng = lng === null ? null : Math.round(lng! * 1e6) / 1e6;
    try {
      this.saveClient(user, clientId, c, 'координаты');
    } catch {
      return api.send(chatId, 'Координаты вне допустимого диапазона.');
    }
    this.setState(chatId, null);
    await api.send(chatId, lat === null ? '✅ Координаты очищены.' : '✅ Координаты сохранены.');
    return this.showClient(api, chatId, clientId);
  }

  private async setStatus(api: TgApi, chatId: number, user: BotUser, clientId: string, status: string, messageId: number) {
    const c = this.client(clientId);
    if (!c || !STATUS[status]) return api.send(chatId, 'Клиент не найден.');
    if (c.status !== status) {
      c.status = status;
      this.saveClient(user, clientId, c, `статус → ${STATUS[status]}`);
    }
    return this.showClient(api, chatId, clientId, messageId);
  }

  // ---------- history ----------

  private history(api: TgApi, chatId: number, clientId: string, messageId: number) {
    const c = this.client(clientId);
    if (!c) return api.send(chatId, 'Клиент не найден.');
    const events = this.events(clientId);
    const kb: Keyboard = events.slice(0, 12).map((e) => [{ text: `${e.date} ${EVENT_KIND[e.kind as string]?.split(' ')[0] ?? ''} ${short(e.text, 40)}`, callback_data: `e:${e.id}` }]);
    kb.push([{ text: '📝 Добавить запись', callback_data: `ha:${clientId}` }]);
    kb.push([{ text: '« К клиенту', callback_data: `c:${clientId}` }]);
    const text = events.length
      ? `📜 История: <b>${esc(c.fullName)}</b> (${events.length})${events.length > 12 ? ', показаны последние 12' : ''}. Нажмите на запись, чтобы изменить или удалить.`
      : `📜 У <b>${esc(c.fullName)}</b> пока нет записей в истории.`;
    return api.edit(chatId, messageId, text, kb);
  }

  private showEvent(api: TgApi, chatId: number, id: string, messageId?: number) {
    const ev = this.event(id);
    if (!ev) return api.send(chatId, 'Запись не найдена (возможно, удалена).');
    const c = this.client(ev.clientId as string);
    const text =
      `${EVENT_KIND[ev.kind as string] ?? ''} · ${esc(ev.date)}\nКлиент: <b>${esc(c?.fullName ?? '—')}</b>\n` +
      `Автор: ${esc(this.employeeName(ev.createdBy))}\n\n${esc(short(ev.text, 3500))}`;
    const kb: Keyboard = [
      [
        { text: '✏️ Изменить текст', callback_data: `ee:${id}` },
        { text: '🗑 Удалить', callback_data: `ed:${id}` },
      ],
      [{ text: '« К истории', callback_data: `h:${ev.clientId}` }],
    ];
    return messageId ? api.edit(chatId, messageId, text, kb) : api.send(chatId, text, kb);
  }

  private async addEvent(api: TgApi, chatId: number, user: BotUser, clientId: string, kind: string, text: string) {
    if (!this.client(clientId)) return api.send(chatId, 'Клиент не найден.');
    const parsed = clientEventSchema.safeParse({ clientId, kind, date: mskDay(this.ctx.now()), text });
    if (!parsed.success) return api.send(chatId, `Ошибка: ${esc(parsed.error.issues[0]?.message)}`);
    const rec = insertRecord(this.ctx, 'client_event', parsed.data, user.id);
    this.audit(user, 'create', 'client_event', rec.id, short(text, 60));
    this.setState(chatId, null);
    await api.send(chatId, '✅ Запись добавлена в историю.');
    return this.showClient(api, chatId, clientId);
  }

  private async editEvent(api: TgApi, chatId: number, user: BotUser, id: string, text: string) {
    const row = getRow(this.ctx, 'client_event', id);
    if (!row) return api.send(chatId, 'Запись не найдена.');
    const parsed = clientEventSchema.safeParse({ ...JSON.parse(row.data), text });
    if (!parsed.success) return api.send(chatId, `Ошибка: ${esc(parsed.error.issues[0]?.message)}`);
    updateRecordData(this.ctx, id, parsed.data, user.id);
    this.audit(user, 'update', 'client_event', id, short(text, 60));
    this.setState(chatId, null);
    await api.send(chatId, '✅ Запись изменена.');
    return this.showEvent(api, chatId, id);
  }

  private async deleteEvent(api: TgApi, chatId: number, user: BotUser, id: string, messageId: number) {
    const row = getRow(this.ctx, 'client_event', id);
    if (!row) return api.send(chatId, 'Запись уже удалена.');
    const data = JSON.parse(row.data);
    this.ctx.db.prepare('UPDATE records SET deleted_at = ?, deleted_by = ? WHERE id = ?').run(this.ctx.now(), user.id, id);
    this.audit(user, 'delete', 'client_event', id, short(data.text, 60));
    return this.history(api, chatId, data.clientId, messageId);
  }

  private async savePhoto(api: TgApi, chatId: number, user: BotUser, clientId: string, m: TgMessage) {
    const c = this.client(clientId);
    if (!c) return api.send(chatId, 'Клиент не найден.');
    const photo = m.photo?.at(-1);
    const doc = m.document;
    if (doc && !doc.mime_type?.startsWith('image/')) return api.send(chatId, 'Можно прикрепить только изображения.');
    const fileId = photo?.file_id ?? doc!.file_id;
    let buffer: Buffer;
    try {
      buffer = await api.download(fileId);
    } catch (err) {
      return api.send(chatId, `Не удалось получить файл: ${esc((err as Error).message)}`);
    }
    try {
      const file = await storeFile(
        this.ctx,
        { buffer, filename: doc?.file_name ?? `telegram-${mskDay(this.ctx.now())}.jpg`, mimetype: doc?.mime_type ?? 'image/jpeg', ownerType: 'client', ownerId: clientId, kind: 'photo', caption: short(m.caption, 500) },
        user.id,
      );
      this.audit(user, 'create', 'file', file.id, `${file.name} → client`);
    } catch (err) {
      return api.send(chatId, `Ошибка: ${esc((err as Error).message)}`);
    }
    this.setState(chatId, { kind: 'photo', clientId });
    return api.send(chatId, `✅ Фото добавлено к <b>${esc(c.fullName)}</b>. Можно отправить ещё.`, [[{ text: 'Готово', callback_data: `c:${clientId}` }]]);
  }

  // ---------- tasks & routes ----------

  private tasks(api: TgApi, chatId: number, user: BotUser) {
    const open = listRecords(this.ctx, 'task', { assigneeId: user.id }).filter((t) => !t.done);
    if (!open.length) return api.send(chatId, '📋 Открытых задач, назначенных на вас, нет.', [[{ text: '« Меню', callback_data: 'menu' }]]);
    open.sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')));
    const lines = open.slice(0, 20).map((t, i) => {
      const client = t.clientId ? this.client(t.clientId as string) : null;
      return `${i + 1}. ${esc(short(t.text, 200))}${t.due ? ` — до ${esc(t.due)}` : ''}${client ? ` (${esc(client.fullName)})` : ''}`;
    });
    const kb: Keyboard = open.slice(0, 20).map((t, i) => [{ text: `✓ ${i + 1}. ${short(t.text, 40)}`, callback_data: `td:${t.id}` }]);
    kb.push([{ text: '« Меню', callback_data: 'menu' }]);
    return api.send(chatId, `📋 <b>Мои задачи</b> (${open.length})\n${lines.join('\n')}\n\nНажмите на задачу, чтобы отметить её выполненной.`, kb);
  }

  private async completeTask(api: TgApi, chatId: number, user: BotUser, id: string, messageId: number) {
    const row = getRow(this.ctx, 'task', id);
    if (!row) return api.send(chatId, 'Задача не найдена.');
    const data = taskSchema.parse({ ...JSON.parse(row.data), done: true });
    updateRecordData(this.ctx, id, data, user.id);
    this.audit(user, 'update', 'task', id, `выполнено: ${short(data.text, 60)}`);
    await api.edit(chatId, messageId, `✅ Выполнено: ${esc(short(data.text, 300))}`, [[{ text: '📋 Мои задачи', callback_data: 'tk' }]]);
  }

  private routes(api: TgApi, chatId: number, user: BotUser) {
    const today = mskDay(this.ctx.now());
    const list = listRecords(this.ctx, 'route', { assigneeId: user.id }).filter((r) => r.date === today && r.status !== 'cancelled');
    if (!list.length) return api.send(chatId, `🗺 На сегодня (${fmtDay(today)}) выездов нет.`, [[{ text: '« Меню', callback_data: 'menu' }]]);
    list.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    const blocks = list.map((r) => {
      const client = r.clientId ? this.client(r.clientId as string) : null;
      const road = r.road as { distanceKm: number; durationMin: number } | null;
      const pts = (r.points as { lat: number; lng: number; label: string }[]) ?? [];
      const head = `<b>${esc(r.time || '—')} ${esc(r.name)}</b> · ${ROUTE_STATUS[r.status as string] ?? r.status}`;
      const info = [client && `Клиент: ${esc(client.fullName)}`, road ? `${road.distanceKm} км, ~${road.durationMin} мин` : `${r.distanceKm} км по прямой`].filter(Boolean).join(' · ');
      const points = pts.slice(0, 10).map((p, i) => `  ${i + 1}. <a href="https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}">${esc(p.label || `${p.lat}, ${p.lng}`)}</a>`);
      return [head, info, ...points].join('\n');
    });
    return api.send(chatId, `🗺 <b>Выезды на ${fmtDay(today)}</b>\n\n${blocks.join('\n\n')}`, [[{ text: '« Меню', callback_data: 'menu' }]]);
  }
}
