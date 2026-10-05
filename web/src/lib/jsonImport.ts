/**
 * "Smart" import of credentials from arbitrary JSON: walks the whole tree and turns every
 * object that looks like a credential (has a password-ish field) into an entry. Works with
 * flat arrays, nested structures, keyed maps ({"github.com": {...}}) and exports of common
 * password managers (Bitwarden: items[].login.{username,password,uris[].uri}).
 */
import type { VaultCategory, VaultSecret } from './types';

const PASSWORD_KEYS = ['password', 'pass', 'passwd', 'pwd', 'pw', 'secret', 'token', 'accesstoken', 'access_token', 'authtoken', 'apikey', 'api_key', 'пароль', 'parol', 'passwort', 'kennwort', 'токен'];
const LOGIN_KEYS = ['login', 'username', 'user', 'user_name', 'userName', 'account', 'логин', 'benutzer', 'benutzername', 'nickname', 'uid'];
const EMAIL_KEYS = ['email', 'e-mail', 'mail', 'почта', 'emailaddress', 'email_address'];
const URL_KEYS = ['url', 'uri', 'link', 'href', 'website', 'web', 'origin', 'origin_url', 'login_uri', 'loginurl', 'адрес'];
const SITE_KEYS = ['site', 'domain', 'host', 'hostname', 'service', 'name', 'title', 'сайт', 'сервис', 'app', 'resource'];
const NOTE_KEYS = ['notes', 'note', 'comment', 'comments', 'description', 'заметка', 'заметки', 'комментарий'];

const norm = (k: string) => k.toLowerCase().replace(/[\s_-]/g, '');
const keySet = (keys: string[]) => new Set(keys.map(norm));
const PW = keySet(PASSWORD_KEYS);
const LOGIN = keySet(LOGIN_KEYS);
const EMAIL = keySet(EMAIL_KEYS);
const URL_ = keySet(URL_KEYS);
const SITE = keySet(SITE_KEYS);
const NOTE = keySet(NOTE_KEYS);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isScalar = (v: unknown) => typeof v === 'string' || typeof v === 'number';

function pick(o: Obj, keys: Set<string>): string {
  for (const [k, v] of Object.entries(o)) if (keys.has(norm(k)) && isScalar(v) && String(v).trim()) return String(v).trim();
  return '';
}

/** Bitwarden-style: uris: [{uri: "..."}] or urls: ["..."] */
function pickUrlList(o: Obj): string {
  for (const [k, v] of Object.entries(o)) {
    if (!['uris', 'urls', 'links', 'websites'].includes(norm(k)) || !Array.isArray(v)) continue;
    for (const item of v) {
      if (typeof item === 'string' && item.trim()) return item.trim();
      if (isObj(item)) {
        const u = pick(item, URL_);
        if (u) return u;
      }
    }
  }
  return '';
}

export function hostOf(urlOrSite: string): string {
  const s = urlOrSite.trim();
  if (!s) return '';
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return s.toLowerCase();
  }
}

function looksLikeUrl(s: string) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s);
}

/** Guesses a category from the site/url so imported Discord/Steam accounts land in the right place. */
export function guessCategory(site: string, url: string): VaultCategory {
  const h = `${hostOf(url)} ${site}`.toLowerCase();
  if (/discord/.test(h)) return 'discord';
  if (/steam/.test(h)) return 'steam';
  if (/(epicgames|ea\.com|origin|ubisoft|battle\.net|riotgames|minecraft|mojang|roblox|xbox|playstation|psn|nintendo|gog\.com|twitch)/.test(h)) return 'game';
  if (/(gmail|mail\.|outlook|proton|yandex|yahoo|icloud)/.test(h)) return 'email';
  if (/(vk\.com|facebook|instagram|twitter|x\.com|tiktok|telegram|ok\.ru|linkedin|reddit)/.test(h)) return 'social';
  return 'site';
}

export interface ParsedEntry extends VaultSecret {
  /** JSON path where the entry was found, for the preview. */
  path: string;
}

function fromObject(o: Obj, parentKey: string | null): ParsedEntry | null {
  // Bitwarden nests credentials under "login"; merge it with the outer item.
  const inner = isObj(o.login) ? (o.login as Obj) : null;
  const scope: Obj = inner ? { ...o, ...inner, name: o.name ?? inner.name } : o;

  const password = pick(scope, PW);
  if (!password) return null;
  const email = pick(scope, EMAIL);
  const login = pick(scope, LOGIN) || email;
  let url = pick(scope, URL_) || pickUrlList(scope);
  let site = pick(scope, SITE);
  if (!site && parentKey && !/^\d+$/.test(parentKey)) site = parentKey;
  if (!url && site && looksLikeUrl(site)) url = site;
  if (!site && url) site = hostOf(url);
  const notesParts = [pick(scope, NOTE)];
  if (email && email !== login) notesParts.push(`Email: ${email}`);
  return { site, url, login, password, notes: notesParts.filter(Boolean).join('\n'), category: guessCategory(site, url), fields: [], path: '' };
}

export interface ParseResult {
  entries: ParsedEntry[];
  error: string | null;
}

export function parseCredentialsJson(text: string): ParseResult {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    // Allow JSON Lines (one object per line) as a fallback.
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    try {
      root = lines.map((l) => JSON.parse(l));
    } catch {
      return { entries: [], error: `Это не JSON: ${(e as Error).message}` };
    }
  }

  const entries: ParsedEntry[] = [];
  const walk = (node: unknown, path: string, parentKey: string | null, depth: number) => {
    if (depth > 30) return;
    if (Array.isArray(node)) {
      // Array items are siblings, not named by the array's key ("servers": [...] is not a site name).
      node.forEach((v, i) => walk(v, `${path}[${i}]`, null, depth + 1));
      return;
    }
    if (!isObj(node)) return;
    const entry = fromObject(node, parentKey);
    if (entry) {
      entries.push({ ...entry, path: path || '$' });
      return;
    }
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k, k, depth + 1);
  };
  walk(root, '', null, 0);
  return { entries, error: entries.length ? null : 'В JSON не найдено ни одной записи с паролем' };
}

/** Key used for duplicate detection: same host + same login. */
export function dedupeKey(e: Pick<VaultSecret, 'site' | 'url' | 'login'>) {
  return `${hostOf(e.url || e.site)}|${e.login.trim().toLowerCase()}`;
}
