const dtf = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function fmtDateTime(ts: number | null | undefined) {
  return ts ? dtf.format(new Date(ts)) : '—';
}

/** Formats "YYYY-MM-DD" (as stored by <input type=date>) without timezone shifts. */
export function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : df.format(d);
}

export function fmtAgo(ts: number | null | undefined, now = Date.now()) {
  if (!ts) return 'никогда';
  const s = Math.round((now - ts) / 1000);
  if (s < 60) return 'только что';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} дн назад`;
  return fmtDateTime(ts);
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

const mskTimeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });

/** "HH:MM" in Moscow time (check-in deadlines are in MSK regardless of the browser's zone). */
export function fmtMskTime(ts: number) {
  return mskTimeFmt.format(new Date(ts));
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function uid() {
  return crypto.randomUUID();
}

export const CLIENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  new: { label: 'Новый', tone: 'info' },
  active: { label: 'Активный', tone: 'ok' },
  paused: { label: 'Пауза', tone: 'warn' },
  former: { label: 'Бывший', tone: 'neutral' },
};

export const EMPLOYEE_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: 'Активен', tone: 'ok' },
  vacation: { label: 'Отпуск', tone: 'warn' },
  fired: { label: 'Уволен', tone: 'bad' },
};

export const EVENT_KIND: Record<string, string> = {
  call: 'Звонок',
  meeting: 'Встреча',
  visit: 'Выезд',
  note: 'Заметка',
};

export const DEVICE_KIND: Record<string, string> = { esp32: 'ESP32', uno: 'Arduino Uno', other: 'Другое' };

export const ENTITY_LABEL: Record<string, string> = {
  client: 'Клиент',
  client_event: 'История клиента',
  zt_network: 'Сеть ZeroTier',
  zt_member: 'Узел ZeroTier',
  device: 'Устройство',
  task: 'Задача',
  serial_template: 'Шаблон команды',
  vault_item: 'Пароль',
  vault: 'Хранилище паролей',
  employee: 'Сотрудник',
  user: 'Сотрудник',
  file: 'Файл',
  file_photo: 'Фото',
  file_file: 'Файл',
  file_avatar: 'Аватар',
  record: 'Запись',
  settings: 'Настройки',
  system: 'Система',
};

export const ACTION_LABEL: Record<string, string> = {
  login: 'Вход',
  login_fail: 'Неудачный вход',
  logout: 'Выход',
  password_change: 'Смена пароля',
  password_reset: 'Сброс пароля',
  create: 'Создание',
  update: 'Изменение',
  delete: 'Удаление',
  restore: 'Восстановление',
  purge: 'Удаление навсегда',
  reveal: 'Просмотр пароля',
  copy: 'Копирование пароля',
  import: 'Импорт',
  export: 'Экспорт',
  sync: 'Синхронизация',
  backup: 'Бэкап',
  vault_init: 'Создание хранилища',
  vault_rekey: 'Смена мастер-ключа',
  settings: 'Настройки',
  checkin: 'Отметка',
  tg_link: 'Привязка Telegram',
  tg_unlink: 'Отвязка Telegram',
};

export type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info';
