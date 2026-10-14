import { useQuery } from '@tanstack/react-query';
import { Ban, Coins, CreditCard, Lock, Search, ShieldAlert, Unlock, UserCog } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BankCard } from '../components/BankCard';
import { Badge, Button, Card, Checkbox, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Textarea, cx, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { dateTime, formatAccount, money, toAmount } from '../lib/format';
import { ACCOUNT_KIND_TITLE, type Account, type Card as CardT } from '../lib/types';

interface ClientRow {
  id: string;
  name: string;
  phone: string;
  role: string;
  tariff: string;
  blocked: number;
  created_at: number;
  rub: number;
  restricted: number;
}

export function Clients() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const { data, error } = useQuery({ queryKey: ['admin', 'users', q], queryFn: () => api<{ items: ClientRow[] }>(`/admin/users?q=${encodeURIComponent(q)}`) });
  return (
    <>
      <PageHeader title="Клиенты" sub="Поиск по имени, телефону, номеру счёта или 4 последним цифрам карты" />
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-faint" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Иван, +7 900…, 40817…, 1234" className="pl-11" />
      </div>
      {error && <ErrorNote>{errorText(error)}</ErrorNote>}
      {!data ? <Loading /> : (
        <Card pad={false} className="overflow-hidden">
          {data.items.map((u) => (
            <button key={u.id} type="button" onClick={() => nav(`/admin/clients/${u.id}`)} className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-sunken/70">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft font-bold text-brand">{u.name[0]}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                  <span className="truncate">{u.name}</span>
                  {u.role !== 'client' && <Badge tone="info">{u.role === 'admin' ? 'админ' : 'поддержка'}</Badge>}
                  {u.tariff === 'prime' && <Badge tone="warn">Prime</Badge>}
                  {!!u.blocked && <Badge tone="bad">вход заблокирован</Badge>}
                  {u.restricted > 0 && <Badge tone="bad">ограничения: {u.restricted}</Badge>}
                </span>
                <span className="block text-sm text-muted num">{u.phone}</span>
              </span>
              <span className="shrink-0 font-bold num">{money(u.rub)}</span>
            </button>
          ))}
          {!data.items.length && <div className="px-5 py-10 text-center text-muted">Никого не нашли</div>}
        </Card>
      )}
    </>
  );
}

interface Detail {
  user: { id: string; name: string; phone: string; role: string; tariff: string; blocked: number; blockReason: string | null; birthDate: string; bonus: number; createdAt: number };
  accounts: Account[];
  cards: CardT[];
  restrictions: { id: string; type: string; typeTitle: string; reasonTitle: string; comment: string; amount: number; account_id: string | null; created_at: number; lifted_at: number | null; lift_comment: string | null }[];
  loans: { id: string; principal: number; rate: number; term: number; payment: number; penalty: number; status: string; createdAt: number }[];
  applications: { id: string; product: string; amount: number; status: string; score: number | null; created_at: number }[];
  entries: { id: number; amount: number; currency: string; title: string; subtitle: string; createdAt: number; accountName: string; kind: string }[];
}

export function ClientDetail() {
  const { id = '' } = useParams();
  const toast = useToast();
  const { data, error, refetch } = useQuery({ queryKey: ['admin', 'user', id], queryFn: () => api<Detail>(`/admin/users/${id}`) });
  const [adjust, setAdjust] = useState<Account | null>(null);
  const [restrict, setRestrict] = useState(false);
  const [blockUser, setBlockUser] = useState(false);
  const [limitAcc, setLimitAcc] = useState<Account | null>(null);
  if (error) return <ErrorNote>{errorText(error)}</ErrorNote>;
  if (!data) return <Loading />;
  const u = data.user;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      await refetch();
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  };
  return (
    <>
      <PageHeader
        title={u.name}
        sub={<span className="num">{u.phone} · с {dateTime(u.createdAt)}{u.birthDate ? ` · д.р. ${u.birthDate.split('-').reverse().join('.')}` : ''}</span>}
        actions={
          <>
            <Button icon={<ShieldAlert className="size-4" />} variant="danger" onClick={() => setRestrict(true)}>Ограничение</Button>
            {u.blocked ? <Button icon={<Unlock className="size-4" />} onClick={() => void run(() => api(`/admin/users/${id}/block`, { body: { blocked: false } }), 'Вход разблокирован')}>Разблокировать вход</Button> : <Button icon={<Lock className="size-4" />} onClick={() => setBlockUser(true)}>Заблокировать вход</Button>}
            <Select aria-label="Роль" value={u.role} onChange={(e) => void run(() => api(`/admin/users/${id}/role`, { body: { role: e.target.value } }), 'Роль изменена')} className="!h-11 w-auto">
              <option value="client">Клиент</option>
              <option value="support">Поддержка</option>
              <option value="admin">Администратор</option>
            </Select>
          </>
        }
      />
      {!!u.blocked && <div className="mb-4"><ErrorNote>Вход в приложение заблокирован{u.blockReason ? `: ${u.blockReason}` : ''}</ErrorNote></div>}

      {data.restrictions.some((r) => !r.lifted_at) && (
        <Card className="mb-4 !bg-bad-soft">
          <div className="mb-2 font-bold text-bad">Действующие ограничения</div>
          {data.restrictions.filter((r) => !r.lifted_at).map((r) => (
            <div key={r.id} className="flex flex-col gap-2 border-t border-bad/15 py-2 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1 text-sm">
                <b>{r.typeTitle}{r.amount ? ` ${money(r.amount)}` : ''}</b> · {r.reasonTitle}{r.comment ? ` · ${r.comment}` : ''}
                <div className="text-xs text-muted">{r.account_id ? `Счёт •• ${data.accounts.find((a) => a.id === r.account_id)?.number.slice(-4)}` : 'Все счета'} · {dateTime(r.created_at)}</div>
              </div>
              <LiftButton id={r.id} onDone={() => void refetch()} />
            </div>
          ))}
        </Card>
      )}

      <h2 className="mb-3 text-lg font-extrabold">Счета</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {data.accounts.map((a) => (
          <Card key={a.id} className={cx('!p-4', a.status === 'closed' && 'opacity-50')}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-bold">{a.name}</div>
                <div className="text-xs text-muted num">{ACCOUNT_KIND_TITLE[a.kind]} · {formatAccount(a.number)}</div>
              </div>
              <div className="text-right">
                <div className="font-extrabold num">{money(a.balance, a.currency, { exact: true })}</div>
                {(a.held > 0 || a.arrested > 0 || a.creditLimit > 0) && <div className="text-xs text-muted">{a.creditLimit ? `лимит ${money(a.creditLimit)} · ` : ''}{a.held ? `холд ${money(a.held, a.currency)} ` : ''}{a.arrested ? `арест ${money(a.arrested, a.currency)}` : ''}</div>}
              </div>
            </div>
            {a.status === 'open' && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" icon={<Coins className="size-4" />} onClick={() => setAdjust(a)}>Начислить / списать</Button>
                {a.kind === 'credit_card' && <Button size="sm" onClick={() => setLimitAcc(a)}>Лимит</Button>}
              </div>
            )}
          </Card>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-lg font-extrabold">Карты</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.cards.map((c) => (
          <div key={c.id} className="flex flex-col gap-2">
            <BankCard card={c} size="lg" />
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted">{c.tariffTitle} · {c.statusReason ?? (c.status === 'active' ? 'активна' : c.status)}</span>
              {c.status === 'active' || c.status === 'frozen' ? (
                <Button size="sm" variant="danger" icon={<Ban className="size-4" />} onClick={() => void run(() => api(`/admin/cards/${c.id}/status`, { body: { status: 'blocked', reason: 'Решение банка' } }), 'Карта заблокирована')}>Блок</Button>
              ) : c.status === 'blocked' ? (
                <Button size="sm" icon={<CreditCard className="size-4" />} onClick={() => void run(() => api(`/admin/cards/${c.id}/status`, { body: { status: 'active' } }), 'Карта разблокирована')}>Разблок</Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {(data.loans.length > 0 || data.applications.length > 0) && (
        <>
          <h2 className="mb-3 mt-8 text-lg font-extrabold">Кредитная история</h2>
          <Card pad={false} className="divide-y divide-line overflow-hidden text-sm">
            {data.loans.map((l) => (
              <div key={l.id} className="flex justify-between gap-3 px-4 py-3"><span>Кредит {money(l.principal)} · {l.rate}% · {l.term} мес.</span><Badge tone={l.status === 'overdue' ? 'bad' : l.status === 'closed' ? 'neutral' : 'brand'}>{l.status === 'overdue' ? 'просрочка' : l.status === 'closed' ? 'закрыт' : 'активен'}</Badge></div>
            ))}
            {data.applications.map((a) => (
              <div key={a.id} className="flex justify-between gap-3 px-4 py-3 text-muted"><span>Заявка: {a.product === 'loan' ? 'кредит' : 'кредитка'} {money(a.amount)} · скоринг {a.score ?? '—'}</span><span>{a.status}</span></div>
            ))}
          </Card>
        </>
      )}

      <h2 className="mb-3 mt-8 text-lg font-extrabold">Последние операции</h2>
      <Card pad={false} className="overflow-hidden">
        {data.entries.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 text-sm last:border-0">
            <div className="min-w-0"><div className="truncate font-semibold">{e.title}</div><div className="truncate text-xs text-muted">{e.subtitle} · {e.accountName} · {dateTime(e.createdAt)}</div></div>
            <span className={cx('shrink-0 font-bold num', e.amount > 0 && 'text-ok')}>{money(e.amount, e.currency, { sign: true, exact: true })}</span>
          </div>
        ))}
        {!data.entries.length && <div className="px-5 py-8 text-center text-muted">Операций нет</div>}
      </Card>

      {adjust && <AdjustModal acc={adjust} onClose={() => setAdjust(null)} onDone={() => void refetch()} />}
      {limitAcc && <LimitModal acc={limitAcc} onClose={() => setLimitAcc(null)} onDone={() => void refetch()} />}
      <RestrictModal open={restrict} userId={id} accounts={data.accounts.filter((a) => a.status === 'open')} onClose={() => setRestrict(false)} onDone={() => void refetch()} />
      <BlockModal open={blockUser} userId={id} onClose={() => setBlockUser(false)} onDone={() => void refetch()} />
    </>
  );
}

function LiftButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const toast = useToast();
  return (
    <>
      <Button size="sm" icon={<UserCog className="size-4" />} onClick={() => setOpen(true)}>Снять</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Снять ограничение" size="sm" footer={<><Button onClick={() => setOpen(false)}>Отмена</Button><Button variant="primary" onClick={() => void api(`/admin/restrictions/${id}/lift`, { body: { comment } }).then(() => { toast('Ограничение снято'); setOpen(false); onDone(); }, (e) => toast(errorText(e), 'bad'))}>Снять</Button></>}>
        <Field label="Основание снятия" hint="Клиент увидит этот текст"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Постановление об отмене мер от 14.10.2026" /></Field>
      </Modal>
    </>
  );
}

function AdjustModal({ acc, onClose, onDone }: { acc: Account; onClose: () => void; onDone: () => void }) {
  const [dir, setDir] = useState<'credit' | 'debit'>('credit');
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('Зарплата');
  const [comment, setComment] = useState('');
  const [force, setForce] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal open onClose={onClose} title={`${acc.name} •• ${acc.number.slice(-4)}`} footer={<><Button onClick={onClose}>Отмена</Button><Button variant={dir === 'credit' ? 'primary' : 'danger'} loading={busy} onClick={() => {
      const a = toAmount(amount);
      if (!a) return setErr('Укажите сумму');
      setBusy(true);
      setErr(null);
      api(`/admin/accounts/${acc.id}/adjust`, { body: { direction: dir, amount: a, title, comment, force } }).then(() => { toast(dir === 'credit' ? 'Зачислено' : 'Списано'); onDone(); onClose(); }, (e) => setErr(errorText(e))).finally(() => setBusy(false));
    }}>{dir === 'credit' ? 'Зачислить' : 'Списать'}</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2">
          {(['credit', 'debit'] as const).map((d) => <button key={d} type="button" onClick={() => setDir(d)} className={cx('h-11 rounded-2xl font-semibold', dir === d ? (d === 'credit' ? 'bg-brand text-on-brand' : 'bg-bad text-white') : 'bg-sunken')}>{d === 'credit' ? 'Начислить' : 'Списать'}</button>)}
        </div>
        <Field label={`Сумма, ${acc.currency}`}><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-xl font-extrabold num" /></Field>
        <Field label="Название операции" hint="Так операция появится в истории клиента"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Комментарий"><Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Необязательно" /></Field>
        {dir === 'debit' && <Checkbox checked={force} onChange={setForce} label="Списать даже при нехватке средств или ограничениях" />}
        {err && <ErrorNote>{err}</ErrorNote>}
      </div>
    </Modal>
  );
}

function LimitModal({ acc, onClose, onDone }: { acc: Account; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState(String(acc.creditLimit / 100));
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title="Кредитный лимит" size="sm" footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={() => void api(`/admin/accounts/${acc.id}/limit`, { body: { limit: toAmount(v) } }).then(() => (onDone(), onClose()), (e) => setErr(errorText(e)))}>Сохранить</Button></>}>
      <Field label="Новый лимит, ₽" error={err}><Input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} /></Field>
    </Modal>
  );
}

const REASONS: [string, string][] = [
  ['fssp', 'Постановление судебного пристава (ФССП)'],
  ['tax', 'Решение налогового органа (ФНС)'],
  ['aml', 'Проверка операций по 115-ФЗ'],
  ['court', 'Решение суда'],
  ['fraud', 'Подозрение на мошенничество'],
  ['client', 'По заявлению клиента'],
  ['debt', 'Просроченная задолженность'],
  ['other', 'Иное основание'],
];

function RestrictModal({ open, userId, accounts, onClose, onDone }: { open: boolean; userId: string; accounts: Account[]; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<'arrest' | 'block_debit' | 'block_full'>('arrest');
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('fssp');
  const [comment, setComment] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal open={open} onClose={onClose} title="Новое ограничение" footer={<><Button onClick={onClose}>Отмена</Button><Button variant="danger" loading={busy} onClick={() => {
      setBusy(true);
      setErr(null);
      api('/admin/restrictions', { body: { userId, accountId: accountId || null, type, amount: type === 'arrest' ? toAmount(amount) ?? '' : undefined, reason, comment } })
        .then(() => { toast('Ограничение наложено, клиент уведомлён'); onDone(); onClose(); }, (e) => setErr(errorText(e)))
        .finally(() => setBusy(false));
    }}>Наложить</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Тип">
          <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="arrest">Арест суммы на счёте</option>
            <option value="block_debit">Запрет списаний (входящие разрешены)</option>
            <option value="block_full">Полная блокировка (карты блокируются)</option>
          </Select>
        </Field>
        <Field label="Счёт" hint={type === 'arrest' ? 'Для ареста счёт обязателен' : 'Пусто — все счета клиента'}>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">{type === 'arrest' ? 'Выберите счёт' : 'Все счета'}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} •• {a.number.slice(-4)} ({money(a.balance, a.currency)})</option>)}
          </Select>
        </Field>
        {type === 'arrest' && <Field label="Сумма ареста" hint="Если денег меньше — будут арестовываться поступления"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
        <Field label="Основание">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        </Field>
        <Field label="Комментарий для клиента" hint="Номер документа, исполнительного производства и т. п."><Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="ИП № 123456/26/77001-ИП от 14.10.2026" /></Field>
        {err && <ErrorNote>{err}</ErrorNote>}
      </div>
    </Modal>
  );
}

function BlockModal({ open, userId, onClose, onDone }: { open: boolean; userId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Заблокировать вход" size="sm" footer={<><Button onClick={onClose}>Отмена</Button><Button variant="danger" onClick={() => void api(`/admin/users/${userId}/block`, { body: { blocked: true, reason } }).then(() => (onDone(), onClose()))}>Заблокировать</Button></>}>
      <Field label="Причина" hint="Клиент увидит её при попытке входа"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Подозрение на компрометацию" /></Field>
    </Modal>
  );
}
