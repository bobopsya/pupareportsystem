import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, Eye, EyeOff, FileJson, KeyRound, Lock, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Upload, Wand2, X } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ClientSelect, matches, SearchInput } from '../components/common';
import {
  AddRowButton, Badge, Button, Card, Checkbox, CopyButton, cx, Empty, ErrorText, Field, IconButton, Input, Loading, Modal, Mono, PageHeader, Select, Table, TagInput,
  Textarea, td, th, trHover, useConfirm, useToast,
} from '../components/ui';
import { api, saveBlob } from '../lib/api';
import type { Tone } from '../lib/format';
import { hostOf, dedupeKey, parseCredentialsJson, type ParsedEntry } from '../lib/jsonImport';
import { DEFAULT_GEN, generatePassword, STRENGTH_LABEL, strength, type GenOptions } from '../lib/password';
import { useClientNames, useDeleteRecord, useSaveRecord } from '../lib/queries';
import type { VaultCategory, VaultItem, VaultSecret } from '../lib/types';
import { usePlainVault, useVault, type PlainItem } from '../lib/vault';

const CLIPBOARD_CLEAR_MS = 30_000;

function logEvent(action: 'reveal' | 'copy' | 'export' | 'import', extra: { itemId?: string; count?: number; label?: string } = {}) {
  return api('/vault/events', { body: { action, ...extra } }).catch(() => undefined);
}

// ---------------- Strength meter ----------------
function StrengthBar({ password }: { password: string }) {
  const score = strength(password);
  if (!password) return null;
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={cx('h-1 flex-1 rounded', i < score ? (score >= 3 ? 'bg-ok' : score === 2 ? 'bg-warn' : 'bg-bad') : 'bg-line')} />
        ))}
      </div>
      <span className="w-24 text-right text-xs text-muted">{STRENGTH_LABEL[score]}</span>
    </div>
  );
}

// ---------------- Gate: setup / unlock ----------------
function RecoveryCodeNotice({ code, onDone }: { code: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3 rounded-lg border border-warn/30 bg-warn/5 p-4 text-sm">
        <AlertTriangle className="size-5 shrink-0 text-warn" />
        <div>
          <p className="font-medium text-fg">Сохраните код восстановления</p>
          <p className="mt-1 text-muted">
            Это единственный способ открыть хранилище, если все забудут мастер-ключ. Распечатайте его или запишите и храните отдельно от компьютера. Повторно код не показывается.
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-elevated px-4 py-4">
        <Mono className="text-base tracking-wider break-all">{code}</Mono>
        <CopyButton value={code} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button icon={<Download className="size-4" />} onClick={() => window.print()}>
          Распечатать
        </Button>
        <Checkbox checked={saved} onChange={setSaved} label="Я сохранил(а) код в надёжном месте" />
      </div>
      <Button variant="primary" disabled={!saved} onClick={onDone}>
        Продолжить
      </Button>
    </div>
  );
}

function SetupVault() {
  const vault = useVault();
  const [m, setM] = useState({ a: '', b: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (m.a !== m.b) return setError(new Error('Ключи не совпадают'));
    if (m.a.length < 12) return setError(new Error('Мастер-ключ — минимум 12 символов'));
    if (strength(m.a) < 3) return setError(new Error('Слишком простой мастер-ключ: используйте длинную фразу из нескольких слов'));
    setBusy(true);
    try {
      await vault.init(m.a);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Хранилище ещё не создано. Придумайте <b className="text-fg">мастер-ключ компании</b> — его будут вводить все сотрудники, чтобы видеть пароли. Пароли шифруются прямо в браузере, сервер хранит
        только зашифрованные данные.
      </p>
      <Field label="Мастер-ключ" hint="Лучше фраза из 4–5 слов">
        <Input type="password" autoComplete="new-password" value={m.a} onChange={(e) => setM({ ...m, a: e.target.value })} autoFocus />
      </Field>
      <StrengthBar password={m.a} />
      <Field label="Повторите мастер-ключ">
        <Input type="password" autoComplete="new-password" value={m.b} onChange={(e) => setM({ ...m, b: e.target.value })} />
      </Field>
      <ErrorText error={error} />
      <Button type="submit" variant="primary" loading={busy}>
        Создать хранилище
      </Button>
    </form>
  );
}

function UnlockVault() {
  const vault = useVault();
  const [mode, setMode] = useState<'master' | 'recovery'>('master');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'master') await vault.unlock(secret);
      else await vault.unlockRecovery(secret);
      setSecret('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={mode === 'master' ? 'Мастер-ключ' : 'Код восстановления'}>
        <Input
          type={mode === 'master' ? 'password' : 'text'}
          mono={mode === 'recovery'}
          autoComplete="off"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={mode === 'recovery' ? 'XXXX-XXXX-…' : ''}
          autoFocus
        />
      </Field>
      <ErrorText error={error} />
      <Button type="submit" variant="primary" loading={busy} icon={<KeyRound className="size-4" />}>
        Разблокировать
      </Button>
      <button type="button" className="text-xs text-faint hover:text-fg" onClick={() => (setMode(mode === 'master' ? 'recovery' : 'master'), setSecret(''), setError(null))}>
        {mode === 'master' ? 'Забыли мастер-ключ? Войти по коду восстановления' : 'Ввести мастер-ключ'}
      </button>
      <p className="text-xs text-faint">Хранилище автоматически блокируется через 5 минут бездействия.</p>
    </form>
  );
}

export function VaultGate({ children, compact }: { children: ReactNode; compact?: boolean }) {
  const vault = useVault();
  if (vault.metaLoading) return <Loading />;
  if (vault.unlocked && !vault.pendingRecovery) return <>{children}</>;
  const body = vault.pendingRecovery ? (
    <RecoveryCodeNotice code={vault.pendingRecovery} onDone={vault.ackRecovery} />
  ) : vault.initialized ? (
    <UnlockVault />
  ) : (
    <SetupVault />
  );
  if (compact) return <div className="mx-auto max-w-sm py-4">{body}</div>;
  return (
    <div className="mx-auto mt-6 max-w-md">
      <Card>
        <div className="flex flex-col items-center gap-2 border-b border-line px-6 py-6 text-center">
          <div className="flex size-11 items-center justify-center rounded-full border border-line bg-elevated">
            <Lock className="size-5" />
          </div>
          <h2 className="font-semibold">{vault.pendingRecovery ? 'Хранилище создано' : vault.initialized ? 'Хранилище заблокировано' : 'Новое хранилище паролей'}</h2>
        </div>
        <div className="p-6">{body}</div>
      </Card>
    </div>
  );
}

// ---------------- Password cell ----------------
/** One masked secret with show/copy. Reveals and copies are written to the audit log. */
function MaskedSecret({ value, itemId, label, copyLabel }: { value: string; itemId: string; label?: string; copyLabel: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-1">
      {label && <span className="shrink-0 text-[11px] text-faint">{label}</span>}
      <Mono className={cx('min-w-0 flex-1 truncate', !shown && 'tracking-widest text-muted')}>{shown ? value : '••••••••••'}</Mono>
      <IconButton
        label={shown ? 'Скрыть' : 'Показать'}
        onClick={() => {
          if (!shown) void logEvent('reveal', { itemId, label: copyLabel });
          setShown(!shown);
        }}
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </IconButton>
      <CopyButton value={value} label="Копировать" clearAfterMs={CLIPBOARD_CLEAR_MS} onCopied={() => void logEvent('copy', { itemId, label: copyLabel })} />
    </div>
  );
}

function SecretValue({ item, secret }: { item: VaultItem; secret: VaultSecret }) {
  return (
    <div className="flex flex-col gap-1">
      <MaskedSecret value={secret.password} itemId={item.id} copyLabel={secret.site} />
      {secret.fields?.filter((f) => f.value).map((f, i) => (
        <MaskedSecret key={i} value={f.value} itemId={item.id} label={f.label || 'поле'} copyLabel={`${secret.site} · ${f.label}`} />
      ))}
    </div>
  );
}

// ---------------- Generator ----------------
function GeneratorPanel({ onUse }: { onUse?: (p: string) => void }) {
  const [o, setO] = useState<GenOptions>(DEFAULT_GEN);
  const [pw, setPw] = useState(() => generatePassword(DEFAULT_GEN));
  const regen = (next: GenOptions) => {
    setO(next);
    setPw(generatePassword(next));
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-lg border border-line bg-elevated px-3 py-3">
        <Mono className="min-w-0 flex-1 break-all text-base">{pw}</Mono>
        <IconButton label="Сгенерировать заново" onClick={() => regen(o)}>
          <RefreshCw className="size-4" />
        </IconButton>
        <CopyButton value={pw} clearAfterMs={CLIPBOARD_CLEAR_MS} />
      </div>
      <StrengthBar password={pw} />
      <Field label={`Длина: ${o.length}`}>
        <input type="range" min={8} max={64} value={o.length} onChange={(e) => regen({ ...o, length: Number(e.target.value) })} className="accent-fg" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Checkbox checked={o.lower} onChange={(v) => regen({ ...o, lower: v })} label="a–z" />
        <Checkbox checked={o.upper} onChange={(v) => regen({ ...o, upper: v })} label="A–Z" />
        <Checkbox checked={o.digits} onChange={(v) => regen({ ...o, digits: v })} label="0–9" />
        <Checkbox checked={o.symbols} onChange={(v) => regen({ ...o, symbols: v })} label="!@#$…" />
        <Checkbox checked={o.avoidAmbiguous} onChange={(v) => regen({ ...o, avoidAmbiguous: v })} label="Без похожих (Il1O0)" />
      </div>
      {onUse && (
        <Button variant="primary" onClick={() => onUse(pw)}>
          Использовать этот пароль
        </Button>
      )}
    </div>
  );
}

// ---------------- Item editor ----------------
const EMPTY_SECRET: VaultSecret = { site: '', url: '', login: '', password: '', notes: '', category: 'site', fields: [] };

export const VAULT_CATEGORY: Record<string, { label: string; tone: Tone }> = {
  site: { label: 'Сайт', tone: 'neutral' },
  discord: { label: 'Discord', tone: 'info' },
  steam: { label: 'Steam', tone: 'info' },
  game: { label: 'Игра', tone: 'info' },
  email: { label: 'Почта', tone: 'neutral' },
  social: { label: 'Соцсеть', tone: 'neutral' },
  other: { label: 'Другое', tone: 'neutral' },
};

/** Categories where the "password" is really a token/key. */
function isTokenKind(c: VaultCategory) {
  return c === 'discord' || c === 'steam' || c === 'game';
}

function ItemModal({ item, onClose, defaults }: { item: PlainItem | null; onClose: () => void; defaults?: { clientId?: string | null } }) {
  const vault = useVault();
  const save = useSaveRecord('vault-items');
  const toast = useToast();
  const [s, setS] = useState<VaultSecret>(item?.secret ?? EMPTY_SECRET);
  const [meta, setMeta] = useState({ folder: item?.item.folder ?? '', tags: item?.item.tags ?? [], clientId: item?.item.clientId ?? defaults?.clientId ?? null });
  const [show, setShow] = useState(!item);
  const [gen, setGen] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async () => {
    setError(null);
    if (!s.site.trim() && !s.url.trim()) return setError(new Error('Укажите сайт или адрес'));
    if (!s.password) return setError(new Error('Пустой пароль'));
    try {
      const sealed = await vault.seal({ ...s, site: s.site.trim() || hostOf(s.url) });
      await save.mutateAsync({ ...(item ? { id: item.item.id } : {}), ...sealed, ...meta });
      toast('Сохранено', 'ok');
      onClose();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={item ? 'Редактировать запись' : 'Новая запись'}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => void submit()}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Категория">
          <Select value={s.category} onChange={(e) => setS({ ...s, category: e.target.value as VaultCategory })}>
            {Object.entries(VAULT_CATEGORY).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Клиент">
          <ClientSelect value={meta.clientId} onChange={(clientId) => setMeta({ ...meta, clientId })} />
        </Field>
        <Field label={isTokenKind(s.category) ? 'Название аккаунта / сервиса' : 'Сайт / сервис'}>
          <Input value={s.site} onChange={(e) => setS({ ...s, site: e.target.value })} placeholder={isTokenKind(s.category) ? 'Discord · основной' : 'github.com'} autoFocus />
        </Field>
        <Field label="Адрес (URL)">
          <Input value={s.url} onChange={(e) => setS({ ...s, url: e.target.value })} placeholder="https://…" />
        </Field>
        <Field label={isTokenKind(s.category) ? 'Логин / email / ID' : 'Логин или почта'} className="sm:col-span-2">
          <Input mono value={s.login} onChange={(e) => setS({ ...s, login: e.target.value })} autoComplete="off" />
        </Field>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs font-medium text-muted">{isTokenKind(s.category) ? 'Токен / пароль' : 'Пароль'}</span>
          <div className="flex gap-2">
            <Input mono aria-label={isTokenKind(s.category) ? 'Токен / пароль' : 'Пароль'} type={show ? 'text' : 'password'} value={s.password} onChange={(e) => setS({ ...s, password: e.target.value })} autoComplete="new-password" />
            <IconButton label={show ? 'Скрыть' : 'Показать'} className="size-9 border border-line" onClick={() => setShow(!show)}>
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </IconButton>
            <Button icon={<Wand2 className="size-4" />} onClick={() => setGen(!gen)}>
              Генератор
            </Button>
          </div>
          <StrengthBar password={s.password} />
        </div>
        {gen && (
          <div className="rounded-lg border border-line p-4 sm:col-span-2">
            <GeneratorPanel
              onUse={(p) => {
                setS({ ...s, password: p });
                setShow(true);
                setGen(false);
              }}
            />
          </div>
        )}
        <div className="sm:col-span-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Доп. поля</span>
            <AddRowButton onClick={() => setS({ ...s, fields: [...s.fields, { label: '', value: '' }] })}>Поле</AddRowButton>
          </div>
          {s.fields.length === 0 ? (
            <p className="text-xs text-faint">Любые секреты сверх пароля: Discord-токен, Steam-ключ, 2FA, API-ключ, PIN. Шифруются вместе с записью.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {s.fields.map((f, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-2">
                  <Input placeholder="Название (Токен…)" value={f.label} onChange={(e) => setS({ ...s, fields: s.fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <Input mono placeholder="Значение" value={f.value} onChange={(e) => setS({ ...s, fields: s.fields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                  <IconButton label="Удалить поле" onClick={() => setS({ ...s, fields: s.fields.filter((_, j) => j !== i) })}>
                    <X className="size-4" />
                  </IconButton>
                </div>
              ))}
            </div>
          )}
        </div>
        <Field label="Папка" className="sm:col-span-2">
          <Input value={meta.folder} onChange={(e) => setMeta({ ...meta, folder: e.target.value })} placeholder="Например: Инфраструктура" list="vault-folders" />
        </Field>
        <Field label="Теги" className="sm:col-span-2">
          <TagInput value={meta.tags} onChange={(tags) => setMeta({ ...meta, tags })} />
        </Field>
        <Field label="Заметки" className="sm:col-span-2" hint="Шифруются вместе с паролем">
          <Textarea value={s.notes} onChange={(e) => setS({ ...s, notes: e.target.value })} />
        </Field>
      </div>
      <ErrorText error={error} />
    </Modal>
  );
}

// ---------------- Import ----------------
type ImportStatus = 'new' | 'same' | 'changed' | 'dupInFile';

function ImportModal({ existing, onClose }: { existing: PlainItem[]; onClose: () => void }) {
  const vault = useVault();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<(ParsedEntry & { status: ImportStatus; selected: boolean; existingId?: string })[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState({ folder: '', clientId: null as string | null });
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const byKey = useMemo(() => {
    const m = new Map<string, PlainItem>();
    existing.forEach((p) => p.secret && m.set(dedupeKey(p.secret), p));
    return m;
  }, [existing]);

  const analyze = (src: string) => {
    const r = parseCredentialsJson(src);
    setError(r.error);
    if (!r.entries.length) return setRows(null);
    const seen = new Set<string>();
    setRows(
      r.entries.map((e) => {
        const k = dedupeKey(e);
        const ex = byKey.get(k);
        let status: ImportStatus = 'new';
        if (seen.has(k)) status = 'dupInFile';
        else if (ex) status = ex.secret!.password === e.password ? 'same' : 'changed';
        seen.add(k);
        return { ...e, status, selected: status === 'new' || status === 'changed', existingId: ex?.item.id };
      }),
    );
  };

  const run = async () => {
    if (!rows) return;
    const chosen = rows.filter((r) => r.selected);
    let n = 0;
    for (const r of chosen) {
      setBusy(`Шифрование и сохранение ${++n} из ${chosen.length}…`);
      const sealed = await vault.seal({ site: r.site, url: r.url, login: r.login, password: r.password, notes: r.notes, category: r.category, fields: r.fields });
      if (r.status === 'changed' && r.existingId) {
        const prev = existing.find((p) => p.item.id === r.existingId)!.item;
        await api(`/vault-items/${r.existingId}`, { method: 'PUT', body: { ...prev, ...sealed } });
      } else {
        await api('/vault-items', { body: { ...sealed, folder: target.folder, tags: [], clientId: target.clientId } });
      }
    }
    await logEvent('import', { count: chosen.length });
    qc.invalidateQueries({ queryKey: ['vault-items'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    setBusy(null);
    toast(`Импортировано записей: ${chosen.length}`, 'ok');
    onClose();
  };

  const STATUS: Record<ImportStatus, ReactNode> = {
    new: <Badge tone="ok">новая</Badge>,
    same: <Badge>уже есть</Badge>,
    changed: <Badge tone="warn">обновит пароль</Badge>,
    dupInFile: <Badge>повтор в JSON</Badge>,
  };
  const selectedCount = rows?.filter((r) => r.selected).length ?? 0;

  return (
    <Modal
      open
      wide="xl"
      onClose={onClose}
      title="Импорт паролей из JSON"
      footer={
        rows ? (
          <>
            <Button onClick={() => setRows(null)}>Назад</Button>
            <Button variant="primary" disabled={!selectedCount} loading={!!busy} onClick={() => void run().catch((e) => (setBusy(null), toast(e.message, 'bad')))}>
              {busy ?? `Импортировать (${selectedCount})`}
            </Button>
          </>
        ) : (
          <Button variant="primary" disabled={!text.trim()} onClick={() => analyze(text)}>
            Разобрать
          </Button>
        )
      }
    >
      {!rows ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            Вставьте JSON в любом формате: массив записей, вложенные объекты, экспорт Bitwarden и т. п. Система сама найдёт поля сайта, логина/почты и пароля. Перед сохранением вы увидите
            предпросмотр. Всё шифруется в браузере.
          </p>
          <Textarea
            mono
            className="min-h-64 text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'[\n  { "site": "github.com", "login": "ivan@zhukonet", "password": "…" },\n  { "url": "https://router.local", "username": "admin", "pass": "…" }\n]'}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => fileRef.current?.click()}>
              Загрузить .json файл
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.txt,application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setText(await f.text());
              }}
            />
          </div>
          {error && <p className="text-sm text-bad">{error}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Папка для новых записей">
              <Input value={target.folder} onChange={(e) => setTarget({ ...target, folder: e.target.value })} list="vault-folders" />
            </Field>
            <Field label="Привязать новые записи к клиенту">
              <ClientSelect value={target.clientId} onChange={(clientId) => setTarget({ ...target, clientId })} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted">
            <span>Найдено: {rows.length}</span>
            <span>Новых: {rows.filter((r) => r.status === 'new').length}</span>
            <span>Изменённых: {rows.filter((r) => r.status === 'changed').length}</span>
            <span>Дублей: {rows.filter((r) => r.status === 'same' || r.status === 'dupInFile').length}</span>
          </div>
          <div className="max-h-[50dvh] overflow-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr>
                  <th className={th}>
                    <Checkbox checked={rows.every((r) => r.selected)} onChange={(v) => setRows(rows.map((r) => ({ ...r, selected: v })))} />
                  </th>
                  <th className={th}>Сайт</th>
                  <th className={th}>Логин / почта</th>
                  <th className={th}>Пароль</th>
                  <th className={th}>Статус</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={cx(!r.selected && 'opacity-50')}>
                    <td className={td}>
                      <Checkbox checked={r.selected} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, selected: v } : x)))} />
                    </td>
                    <td className={td}>
                      <div className="font-medium">{r.site || '—'}</div>
                      {r.url && <div className="max-w-64 truncate text-xs text-faint">{r.url}</div>}
                    </td>
                    <td className={td}>
                      <Mono>{r.login || '—'}</Mono>
                    </td>
                    <td className={td}>
                      <Mono className="text-muted">{'•'.repeat(Math.min(12, r.password.length))}</Mono>
                    </td>
                    <td className={td}>{STATUS[r.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------- Linked list (client card) ----------------
export function VaultLinkedList({ clientId }: { clientId: string }) {
  const { plain, loading } = usePlainVault({ clientId });
  const [edit, setEdit] = useState<PlainItem | 'new' | null>(null);
  return (
    <VaultGate compact>
      <div className="mb-3 flex justify-end">
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEdit('new')}>
          Добавить пароль клиента
        </Button>
      </div>
      {loading || !plain ? (
        <Loading />
      ) : plain.length === 0 ? (
        <Empty title="Нет паролей, привязанных к клиенту" />
      ) : (
        <ul className="divide-y divide-line/70 rounded-lg border border-line">
          {plain.map((p) => (
            <li key={p.item.id} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[1fr_1fr_1.2fr_auto] sm:items-center">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{p.secret?.site}</div>
                <div className="truncate text-xs text-faint">{p.item.folder}</div>
              </div>
              <div className="flex min-w-0 items-center gap-1">
                <Mono className="truncate">{p.secret?.login}</Mono>
                {p.secret?.login && <CopyButton value={p.secret.login} label="Копировать логин" />}
              </div>
              {p.secret ? <SecretValue item={p.item} secret={p.secret} /> : <span className="text-bad text-xs">не расшифровано</span>}
              <IconButton label="Изменить" onClick={() => setEdit(p)}>
                <Pencil className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {edit && <ItemModal item={edit === 'new' ? null : edit} defaults={{ clientId }} onClose={() => setEdit(null)} />}
    </VaultGate>
  );
}

// ---------------- Page ----------------
function VaultContent() {
  const vault = useVault();
  const { plain, loading } = usePlainVault();
  const del = useDeleteRecord('vault-items');
  const confirm = useConfirm();
  const cli = useClientNames();
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState('');
  const [category, setCategory] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [health, setHealth] = useState<'' | 'weak' | 'reused'>('');
  const [edit, setEdit] = useState<PlainItem | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [generator, setGenerator] = useState(false);

  const analysis = useMemo(() => {
    const counts = new Map<string, number>();
    const scores = new Map<string, number>();
    plain?.forEach((p) => {
      if (!p.secret) return;
      counts.set(p.secret.password, (counts.get(p.secret.password) ?? 0) + 1);
      scores.set(p.item.id, strength(p.secret.password));
    });
    return { reused: (p: PlainItem) => !!p.secret && (counts.get(p.secret.password) ?? 0) > 1, score: (p: PlainItem) => scores.get(p.item.id) ?? 0 };
  }, [plain]);

  const folders = useMemo(() => Array.from(new Set((plain ?? []).map((p) => p.item.folder).filter(Boolean))).sort(), [plain]);
  const list = (plain ?? [])
    .filter((p) => (!folder || p.item.folder === folder) && (!clientId || p.item.clientId === clientId) && (!category || (p.secret?.category ?? 'site') === category))
    .filter((p) => (health === 'weak' ? analysis.score(p) < 3 : health === 'reused' ? analysis.reused(p) : true))
    .filter((p) => matches(q, p.secret?.site, p.secret?.url, p.secret?.login, p.secret?.notes, p.item.folder, p.item.tags))
    .sort((a, b) => (a.secret?.site ?? '').localeCompare(b.secret?.site ?? '', 'ru'));
  const weakCount = (plain ?? []).filter((p) => analysis.score(p) < 3).length;
  const reusedCount = (plain ?? []).filter((p) => analysis.reused(p)).length;

  const exportAs = async (fmt: 'json' | 'csv') => {
    if (
      !(await confirm({
        title: 'Экспортировать пароли в открытом виде?',
        body: 'Файл будет содержать все пароли без шифрования. Храните его осторожно и удалите после использования. Действие попадёт в журнал.',
        confirmText: 'Экспортировать',
        danger: true,
      }))
    )
      return;
    const rows = list.filter((p) => p.secret).map((p) => ({ ...p.secret!, folder: p.item.folder, tags: p.item.tags.join(', '), client: p.item.clientId ? cli(p.item.clientId) : '' }));
    const stamp = new Date().toISOString().slice(0, 10);
    if (fmt === 'json') saveBlob(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }), `zhukonet-passwords-${stamp}.json`);
    else {
      const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
      const head = ['site', 'url', 'login', 'password', 'notes', 'folder', 'tags', 'client'] as const;
      const csv = [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h] ?? '')).join(','))].join('\r\n');
      saveBlob(new Blob(['﻿' + csv], { type: 'text/csv' }), `zhukonet-passwords-${stamp}.csv`);
    }
    void logEvent('export', { count: rows.length, label: fmt.toUpperCase() });
  };

  return (
    <>
      <PageHeader
        title="Пароли"
        description="Общее хранилище команды. Шифрование AES-256 в браузере, сервер видит только шифротекст."
        actions={
          <>
            <Button icon={<Wand2 className="size-4" />} onClick={() => setGenerator(true)}>
              Генератор
            </Button>
            <Button icon={<FileJson className="size-4" />} onClick={() => setImporting(true)}>
              Импорт JSON
            </Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>
              Добавить
            </Button>
            <Button variant="ghost" icon={<Lock className="size-4" />} onClick={vault.lock}>
              Заблокировать
            </Button>
          </>
        }
      />

      {(weakCount > 0 || reusedCount > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
          <ShieldCheck className="size-4 text-muted" />
          <span className="text-muted">Проверка паролей:</span>
          <button type="button" onClick={() => setHealth(health === 'weak' ? '' : 'weak')} className={cx('rounded px-1', health === 'weak' && 'bg-hover')}>
            <Badge tone={weakCount ? 'warn' : 'ok'}>слабых: {weakCount}</Badge>
          </button>
          <button type="button" onClick={() => setHealth(health === 'reused' ? '' : 'reused')} className={cx('rounded px-1', health === 'reused' && 'bg-hover')}>
            <Badge tone={reusedCount ? 'bad' : 'ok'}>повторяющихся: {reusedCount}</Badge>
          </button>
          {health && (
            <button type="button" className="text-xs text-faint hover:text-fg" onClick={() => setHealth('')}>
              сбросить фильтр
            </button>
          )}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Сайт, логин, заметка…" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex">
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="lg:w-40">
            <option value="">Все категории</option>
            {Object.entries(VAULT_CATEGORY).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
          <Select value={folder} onChange={(e) => setFolder(e.target.value)} className="lg:w-44">
            <option value="">Все папки</option>
            {folders.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </Select>
          <div className="lg:w-56">
            <ClientSelect value={clientId} onChange={setClientId} emptyLabel="Все клиенты" />
          </div>
        </div>
        <div className="flex gap-2 lg:ml-auto">
          <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => void exportAs('json')}>
            JSON
          </Button>
          <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => void exportAs('csv')}>
            CSV
          </Button>
        </div>
      </div>
      <datalist id="vault-folders">
        {folders.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>

      <Card>
        {loading || !plain ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon={<KeyRound />} title={plain.length ? 'Ничего не найдено' : 'Хранилище пусто'}>
            {!plain.length && 'Добавьте пароль вручную или импортируйте JSON.'}
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Сайт</th>
                <th className={th}>Логин / почта</th>
                <th className={`${th} min-w-56`}>Пароль</th>
                <th className={`${th} hidden lg:table-cell`}>Папка / клиент</th>
                <th className={`${th} hidden md:table-cell`}>Надёжность</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const score = analysis.score(p);
                return (
                  <tr key={p.item.id} className={trHover}>
                    <td className={td}>
                      {p.secret ? (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{p.secret.site || hostOf(p.secret.url)}</span>
                            {p.secret.category && p.secret.category !== 'site' && (
                              <Badge tone={VAULT_CATEGORY[p.secret.category]?.tone}>{VAULT_CATEGORY[p.secret.category]?.label}</Badge>
                            )}
                          </div>
                          {p.secret.url && (
                            <a href={/^https?:\/\//i.test(p.secret.url) ? p.secret.url : `https://${p.secret.url}`} target="_blank" rel="noreferrer noopener" className="block max-w-56 truncate text-xs text-faint hover:text-fg">
                              {p.secret.url}
                            </a>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-bad">Не удалось расшифровать</span>
                      )}
                    </td>
                    <td className={td}>
                      <div className="flex items-center gap-1">
                        <Mono className="max-w-56 truncate">{p.secret?.login || '—'}</Mono>
                        {p.secret?.login && <CopyButton value={p.secret.login} label="Копировать логин" />}
                      </div>
                    </td>
                    <td className={td}>{p.secret && <SecretValue item={p.item} secret={p.secret} />}</td>
                    <td className={`${td} hidden lg:table-cell`}>
                      <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
                        {p.item.folder && <Badge>{p.item.folder}</Badge>}
                        {p.item.clientId && <span>{cli(p.item.clientId)}</span>}
                        {p.item.tags.map((t) => (
                          <Badge key={t}>{t}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className={`${td} hidden md:table-cell`}>
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={score >= 3 ? 'ok' : score === 2 ? 'warn' : 'bad'}>{STRENGTH_LABEL[score]}</Badge>
                        {analysis.reused(p) && <Badge tone="bad">повтор</Badge>}
                      </div>
                    </td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <IconButton label="Изменить" onClick={() => setEdit(p)}>
                        <Pencil className="size-4" />
                      </IconButton>
                      <IconButton
                        label="Удалить"
                        onClick={async () => {
                          if (await confirm({ title: `Удалить «${p.secret?.site ?? 'запись'}»?`, body: 'Запись попадёт в корзину на 30 дней.', danger: true, confirmText: 'Удалить' }))
                            del.mutate(p.item.id);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {edit && <ItemModal item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {importing && <ImportModal existing={plain ?? []} onClose={() => setImporting(false)} />}
      {generator && (
        <Modal open onClose={() => setGenerator(false)} title="Генератор паролей">
          <GeneratorPanel />
        </Modal>
      )}
    </>
  );
}

export default function Vault() {
  return (
    <VaultGate>
      <VaultContent />
    </VaultGate>
  );
}

export { RecoveryCodeNotice, StrengthBar };
