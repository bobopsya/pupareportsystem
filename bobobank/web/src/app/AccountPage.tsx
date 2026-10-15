import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, Copy, FileText, Link2, Pencil, Store, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BankCard } from '../components/BankCard';
import { EntryRow } from '../components/EntryRow';
import { Row, Screen } from '../components/Screen';
import { Badge, Button, Card, ErrorNote, Field, Input, Loading, Modal, useCopy, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { dateTime, formatAccount, longDate, money } from '../lib/format';
import { useHome, useMeta, useRefresh } from '../lib/hooks';
import { ACCOUNT_KIND_TITLE, type Account, type Card as CardT, type Entry } from '../lib/types';
import { SectionTitle } from './Shell';

interface AccountData {
  account: Account;
  entries: Entry[];
  cards: CardT[];
  gpayLinks: { shopId: number; shopName: string; usedAt: number }[];
  requisites: { holder: string; number: string; bank: string; bik: string; corr: string; inn: string; kpp: string };
}

export default function AccountPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const refresh = useRefresh();
  const { copy } = useCopy();
  const { data: home } = useHome();
  const { data: meta } = useMeta();
  const { data, error, refetch } = useQuery({ queryKey: ['account', id], queryFn: () => api<AccountData>(`/accounts/${id}`) });
  const [rename, setRename] = useState(false);
  const [closing, setClosing] = useState(false);
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorNote>{errorText(error)}</ErrorNote>;
  if (!data) return <Loading />;
  const a = data.account;
  const r = data.requisites;
  const deposit = a.kind === 'deposit' || a.kind === 'savings';
  const creditCard = a.kind === 'credit_card';
  const minDue = Number(a.params.minDue ?? 0);

  const getCode = async () => {
    try {
      setCode(await api<{ code: string; expiresAt: number }>(`/accounts/${id}/gpay-code`, { body: {} }));
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  };
  const close = async () => {
    setBusy(true);
    try {
      const res = await api<{ forfeit?: number }>(`/accounts/${id}/close`, { body: {} });
      toast(res.forfeit ? `Счёт закрыт, удержано ${money(res.forfeit)} процентов` : 'Счёт закрыт');
      refresh();
      nav('/app', { replace: true });
    } catch (e) {
      toast(errorText(e), 'bad');
    } finally {
      setBusy(false);
      setClosing(false);
    }
  };
  const holder = a.kind === 'business' ? a.name : r.holder;
  const reqText = `Получатель: ${holder}\nСчёт: ${r.number}\nБанк: ${r.bank}\nБИК: ${r.bik}\nКорр. счёт: ${r.corr}\nИНН банка: ${r.inn}\nКПП банка: ${r.kpp}`;

  return (
    <Screen title={a.name} sub={`${ACCOUNT_KIND_TITLE[a.kind]} •• ${a.number.slice(-4)}`} actions={<button type="button" aria-label="Переименовать" onClick={() => setRename(true)} className="inline-flex size-10 items-center justify-center rounded-full hover:bg-sunken"><Pencil className="size-5" /></button>}>
      <Card>
        <div className="text-sm text-muted">{creditCard ? 'Доступно' : 'Баланс'}</div>
        <div className="text-[32px] font-semibold leading-tight num">{money(creditCard ? a.available : a.balance, a.currency, { exact: true })}</div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
          {creditCard && <span>Долг {money(Math.max(0, -a.balance))} из {money(a.creditLimit)}</span>}
          {deposit && <span>{String(a.params.rate)}% годовых</span>}
          {a.kind === 'deposit' && typeof a.params.endsAt === 'number' && <span>до {longDate(a.params.endsAt)}</span>}
          {a.held > 0 && <span>Ожидает списания {money(a.held, a.currency)}</span>}
          {a.arrested > 0 && <span>Арестовано {money(a.arrested, a.currency)}</span>}
        </div>
      </Card>

      {creditCard && minDue > 0 && (
        <div className="mt-3 rounded-[20px] bg-warn-soft px-4 py-3 text-sm text-warn">
          Минимальный платёж {money(minDue)} до {typeof a.params.minDueAt === 'number' ? longDate(a.params.minDueAt) : '—'}
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2">
        {a.kind !== 'deposit' && <QuickBtn icon={<ArrowDownToLine className="size-5" />} label={creditCard ? 'Погасить' : 'Пополнить'} onClick={() => nav(`/app/transfer/own?to=${a.id}`)} />}
        {!creditCard && a.kind !== 'deposit' && <QuickBtn icon={<ArrowUpFromLine className="size-5" />} label="Перевести" onClick={() => nav(`/app/payments?from=${a.id}`)} />}
        <QuickBtn icon={<FileText className="size-5" />} label="Выписка" onClick={() => window.open(`/api/accounts/${a.id}/statement.pdf`, '_blank')} />
      </div>

      {a.kind === 'business' || a.kind === 'current' ? (
        <>
          <SectionTitle>GPAY</SectionTitle>
          <Card>
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#111] text-white"><Store className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">Выручка магазина на этот счёт</div>
                <p className="text-sm text-muted">Получите код и введите его в кабинете GPAY: Настройки магазина → Выплаты → Bobobank.</p>
                {data.gpayLinks.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">{data.gpayLinks.map((l) => <Badge key={`${l.shopId}${l.usedAt}`} tone="brand" icon={<Link2 className="size-3" />}>{l.shopName} · №{l.shopId}</Badge>)}</div>
                )}
              </div>
            </div>
            {code ? (
              <div className="mt-4 rounded-2xl bg-sunken p-4 text-center">
                <div className="text-xs text-muted">Код подключения — действует 30 минут</div>
                <button type="button" onClick={() => { copy(code.code); toast('Код скопирован'); }} className="mt-1 text-[32px] font-semibold tracking-[0.12em] num">{code.code}</button>
                {meta?.gpayUrl && <a href={`${meta.gpayUrl}/app`} target="_blank" rel="noreferrer" className="mt-1 block text-sm font-semibold text-brand">Открыть кабинет GPAY</a>}
              </div>
            ) : (
              <Button className="mt-4 w-full" onClick={() => void getCode()}>Подключить магазин GPAY</Button>
            )}
          </Card>
        </>
      ) : null}

      {data.cards.length > 0 && (
        <>
          <SectionTitle>Карты счёта</SectionTitle>
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
            {data.cards.map((c) => <BankCard key={c.id} card={c} onClick={() => nav(`/app/cards/${c.id}`)} />)}
          </div>
        </>
      )}

      <SectionTitle action={<button type="button" onClick={() => { copy(reqText); toast('Реквизиты скопированы'); }} className="inline-flex items-center gap-1 text-sm font-semibold text-brand"><Copy className="size-4" />Копировать</button>}>Реквизиты</SectionTitle>
      <Card className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[
          ['Получатель', holder],
          ['Номер счёта', formatAccount(r.number)],
          ['Банк', r.bank],
          ['БИК', r.bik],
          ['Корр. счёт', r.corr],
          ['ИНН / КПП банка', `${r.inn} / ${r.kpp}`],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0">
            <div className="text-xs text-muted">{k}</div>
            <div className="break-words font-semibold num">{v}</div>
          </div>
        ))}
        <Button className="sm:col-span-2" icon={<FileText className="size-4" />} onClick={() => window.open(`/api/accounts/${a.id}/requisites.pdf`, '_blank')}>Справка с реквизитами (PDF)</Button>
      </Card>

      <SectionTitle>Операции</SectionTitle>
      <Card pad={false} className="overflow-hidden">
        {data.entries.length ? data.entries.map((e) => <EntryRow key={e.id} e={e} />) : <div className="px-5 py-8 text-center text-sm text-muted">Операций пока нет</div>}
      </Card>

      {!['loan', 'credit_card'].includes(a.kind) && home && (
        <Card pad={false} className="mt-4 overflow-hidden">
          <Row icon={<X className="size-5 text-bad" />} title={a.kind === 'deposit' ? 'Закрыть вклад досрочно' : 'Закрыть счёт'} danger onClick={() => setClosing(true)} />
        </Card>
      )}
      <p className="mt-3 text-xs text-faint">Открыт {dateTime(a.createdAt)}</p>

      <RenameModal open={rename} onClose={() => setRename(false)} name={a.name} onSave={async (name) => { await api(`/accounts/${id}/rename`, { body: { name } }); await refetch(); refresh(); }} />
      <Modal open={closing} onClose={() => setClosing(false)} title={a.kind === 'deposit' ? 'Закрыть вклад?' : 'Закрыть счёт?'} size="sm" footer={<><Button onClick={() => setClosing(false)}>Отмена</Button><Button variant="danger" loading={busy} onClick={() => void close()}>Закрыть</Button></>}>
        <p className="text-sm text-muted">{a.kind === 'deposit' ? 'При досрочном закрытии начисленные проценты сгорят, а сумма вклада вернётся на основной счёт.' : deposit ? 'Остаток с процентами переведём на основной счёт.' : 'Закрыть можно счёт с нулевым остатком и без карт.'}</p>
      </Modal>
    </Screen>
  );
}

function QuickBtn({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1.5 rounded-[20px] bg-surface py-3.5 text-[13px] font-semibold shadow-card hover:bg-sunken">
      <span className="text-brand">{icon}</span>
      {label}
    </button>
  );
}

function RenameModal({ open, onClose, name, onSave }: { open: boolean; onClose: () => void; name: string; onSave: (n: string) => Promise<void> }) {
  const [v, setV] = useState(name);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open={open} onClose={onClose} title="Название счёта" size="sm" footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={() => void onSave(v).then(onClose, (e) => setErr(errorText(e)))}>Сохранить</Button></>}>
      <Field label="Название" error={err}><Input value={v} maxLength={40} onChange={(e) => setV(e.target.value)} /></Field>
    </Modal>
  );
}
