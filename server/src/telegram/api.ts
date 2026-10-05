import type { Ctx } from '../context.js';
import { getSetting } from '../db.js';

export class TgError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

export interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
}

export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  caption?: string;
  photo?: { file_id: string; file_size?: number; width: number; height: number }[];
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  location?: { latitude: number; longitude: number };
}

export interface TgCallback {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallback;
}

export type Button = { text: string; callback_data: string } | { text: string; url: string };
export type Keyboard = Button[][];

export const TOKEN_KEY = 'tg_token';

export function getTgToken(ctx: Ctx): string | null {
  const enc = getSetting(ctx.db, TOKEN_KEY);
  return enc ? ctx.secretCrypto.decryptString(enc) : null;
}

/** Thin Bot API client. Every call goes through ctx.http so tests can stub Telegram. */
export class TgApi {
  constructor(private ctx: Ctx, private token: string) {}

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 20_000, signal?: AbortSignal): Promise<T> {
    let res: Response;
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      res = await this.ctx.http(`${this.ctx.cfg.tgApiUrl}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new TgError(0, 'Telegram недоступен');
    }
    const body = (await res.json().catch(() => null)) as { ok: boolean; result?: T; description?: string; error_code?: number } | null;
    if (!body?.ok) throw new TgError(body?.error_code ?? res.status, body?.description ?? `Telegram ответил ${res.status}`);
    return body.result as T;
  }

  send(chatId: number | string, text: string, keyboard?: Keyboard, html = true) {
    return this.call<TgMessage>('sendMessage', {
      chat_id: chatId,
      text: text.slice(0, 4096),
      ...(html ? { parse_mode: 'HTML' } : {}),
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  /** Replaces the text of a bot message (used for inline-menu navigation); falls back to a new message. */
  async edit(chatId: number, messageId: number, text: string, keyboard?: Keyboard) {
    try {
      await this.call('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: text.slice(0, 4096),
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: keyboard ?? [] },
      });
    } catch (err) {
      // "message is not modified" is harmless; anything else — just send a fresh message.
      if (err instanceof TgError && /not modified/i.test(err.message)) return;
      await this.send(chatId, text, keyboard);
    }
  }

  async download(fileId: string): Promise<Buffer> {
    const f = await this.call<{ file_path?: string }>('getFile', { file_id: fileId });
    if (!f.file_path) throw new TgError(0, 'Файл недоступен');
    const res = await this.ctx.http(`${this.ctx.cfg.tgApiUrl}/file/bot${this.token}/${f.file_path}`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new TgError(res.status, 'Не удалось скачать файл из Telegram');
    return Buffer.from(await res.arrayBuffer());
  }
}

/** HTML-escape for parse_mode=HTML. */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
