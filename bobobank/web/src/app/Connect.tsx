import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Car, CheckCircle2, Link2, ShieldCheck, Unlink, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AccountPicker } from '../components/AccountPicker';
import { Logo } from '../components/Logo';
import { Button, Card, ErrorNote, Loading, Modal, Segmented, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { money } from '../lib/format';
import { useHome } from '../lib/hooks';
import type { Account } from '../lib/types';
import { SectionTitle } from './Shell';

interface PartnerInfo {
  client: string;
  name: string;
  scope: string;
  limit: number;
  maxLimit: number;
}

interface Mandate {
  id: string;
  client: string;
  name: string;
  accountId: string;
  accountLast4: string;
  accountName: string;
  limit: number;
  spent: number;
  usable: boolean;
}

const CHARGEABLE = ['current', 'savings', 'business', 'credit_card', 'kids'];
const LIMITS = [2_000_00, 5_000_00, 10_000_00, 25_000_00];
const limitLabel = (v: number) => `${(v / 100).toLocaleString('ru-RU')} ₽`;

function useChargeable(): Account[] | undefined {
  const { data } = useHome();
  return useMemo(() => data?.accounts.filter((a) => a.currency === 'RUB' && CHARGEABLE.includes(a.kind)), [data]);
}

function PartnerIcon({ client }: { client: string }) {
  return (
    <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#FFD600] text-[#111]">
      {client === 'transport' ? <Car className="size-7" /> : <Link2 className="size-7" />}
    </span>
  );
}

/** «Войти через Bobobank»: a partner service asks to sign the customer in and charge an account. */
export default function Connect() {
  const [params] = useSearchParams();
  const clientId = params.get('client') ?? '';
  const state = params.get('state') ?? '';
  const nav = useNavigate();
  const accounts = useChargeable();
  const { data: p, error } = useQuery({ queryKey: ['partner', clientId], queryFn: () => api<PartnerInfo>(`/partners/${clientId}`), enabled: !!clientId, retry: false });
  const [from, setFrom] = useState('');
  const [limit, setLimit] = useState(10_000_00);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!from && accounts?.length) setFrom(accounts[0].id);
  }, [accounts, from]);
  useEffect(() => {
    if (p) setLimit(p.limit);
  }, [p]);

  const allow = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ redirect: string }>(`/partners/${clientId}/authorize`, { body: { accountId: from, limit, state } });
      window.location.replace(r.redirect);
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  };

  let body;
  if (!clientId) body = <ErrorNote>В ссылке не указан сервис. Вернитесь в приложение и нажмите «Войти через Bobobank» ещё раз.</ErrorNote>;
  else if (error) body = <><ErrorNote>{errorText(error)}</ErrorNote><Button className="mt-4 w-full" onClick={() => nav('/app')}>В Bobobank</Button></>;
  else if (!p || !accounts) body = <Loading />;
  else
    body = (
      <>
        <Card className="text-center">
          <div className="flex items-center justify-center gap-3">
            <PartnerIcon client={p.client} />
          </div>
          <div className="mt-3 text-xl font-semibold">{p.name}</div>
          <p className="mt-2 text-[15px] text-muted">{p.name} {p.scope}.</p>
        </Card>
        {accounts.length ? (
          <Card className="mt-3 flex flex-col gap-4">
            <AccountPicker label="Списывать со счёта" accounts={accounts} value={from} onChange={setFrom} />
            <div>
              <div className="mb-2 text-sm text-muted">Не больше за одно списание</div>
              <Segmented value={String(limit)} onChange={(v) => setLimit(Number(v))} options={LIMITS.filter((l) => l <= p.maxLimit).map((l) => ({ value: String(l), label: limitLabel(l) }))} />
            </div>
            {err && <ErrorNote>{err}</ErrorNote>}
            <Button size="lg" variant="primary" loading={busy} disabled={!from} onClick={() => void allow()}>Разрешить</Button>
            <p className="flex items-start gap-1.5 text-xs text-muted"><ShieldCheck className="size-4 shrink-0 text-brand" />Каждое списание придёт уведомлением. Отключить сервис можно в любой момент: Профиль → Подключённые сервисы.</p>
          </Card>
        ) : (
          <div className="mt-3"><ErrorNote>Нет рублёвого счёта для оплаты. Откройте счёт в Bobobank и попробуйте снова.</ErrorNote></div>
        )}
        <Button className="mt-3 w-full" variant="ghost" onClick={() => nav('/app')}>Отмена</Button>
      </>
    );
  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <div className="mb-6 flex items-center justify-between"><Logo compact /><span className="text-sm text-muted">Вход через Bobobank</span></div>
      {body}
    </div>
  );
}

/** Profile → «Подключённые сервисы»: which account each service charges, the limit, switch off. */
export function ConnectedServices() {
  const qc = useQueryClient();
  const toast = useToast();
  const accounts = useChargeable();
  const { data } = useQuery({ queryKey: ['mandates'], queryFn: () => api<{ mandates: Mandate[] }>('/mandates') });
  const [edit, setEdit] = useState<Mandate | null>(null);
  const [acc, setAcc] = useState('');
  const [limit, setLimit] = useState(0);
  const [busy, setBusy] = useState(false);
  if (!data?.mandates.length) return null;
  const open = (m: Mandate) => (setEdit(m), setAcc(m.accountId), setLimit(m.limit));
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg);
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['mandates'] });
    } catch (e) {
      toast(errorText(e), 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SectionTitle>Подключённые сервисы</SectionTitle>
      <Card pad={false} className="divide-y divide-line overflow-hidden">
        {data.mandates.map((m) => (
          <button key={m.id} type="button" onClick={() => open(m)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-sunken/70">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#FFD600] text-[#111]">{m.client === 'transport' ? <Car className="size-5" /> : <Link2 className="size-5" />}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{m.name}</span>
              <span className="block truncate text-sm text-muted">Счёт •• {m.accountLast4} · до {money(m.limit)} за раз</span>
            </span>
            {m.spent > 0 && <span className="shrink-0 text-sm text-muted num">{money(m.spent)}</span>}
          </button>
        ))}
      </Card>
      <Modal
        open={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.name ?? ''}
        size="sm"
        footer={edit && <Button variant="primary" loading={busy} onClick={() => void act(() => api(`/mandates/${edit.id}`, { method: 'PATCH', body: { accountId: acc, limit } }), 'Сохранено')}>Сохранить</Button>}
      >
        {edit && (
          <div className="flex flex-col gap-4">
            {accounts && <AccountPicker label="Списывать со счёта" accounts={accounts} value={acc} onChange={setAcc} />}
            <div>
              <div className="mb-2 text-sm text-muted">Не больше за одно списание</div>
              <Segmented value={String(limit)} onChange={(v) => setLimit(Number(v))} options={[...new Set([...LIMITS, edit.limit])].sort((a, b) => a - b).map((l) => ({ value: String(l), label: limitLabel(l) }))} />
            </div>
            <p className="text-sm text-muted">Всего оплачено через Bobobank: {money(edit.spent)}</p>
            <Button variant="ghost" className="!text-bad" icon={<Unlink className="size-4" />} loading={busy} onClick={() => void act(() => api(`/mandates/${edit.id}`, { method: 'DELETE' }), `${edit.name} отключён`)}>Отключить сервис</Button>
          </div>
        )}
      </Modal>
    </>
  );
}

export interface PartnerRequest {
  id: string;
  status: 'pending' | 'approved' | 'declined' | 'expired';
  client: string;
  name: string;
  returnUrl: string | null;
  title: string;
  amount: number;
  expiresAt: number;
  accountLast4: string;
  accountName: string;
  available: number;
}

/** A partner asks to freeze an amount above the mandate limit (a jet, a helicopter): the customer decides. */
export function PartnerRequestCard({ r, onDecided }: { r: PartnerRequest; onDecided?: (r: PartnerRequest) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
  const [left, setLeft] = useState(() => Math.max(0, Math.round((r.expiresAt - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, Math.round((r.expiresAt - Date.now()) / 1000))), 1000);
    return () => clearInterval(t);
  }, [r.expiresAt]);
  const answer = async (approve: boolean) => {
    setBusy(approve ? 'yes' : 'no');
    try {
      const res = await api<PartnerRequest>(`/partner-requests/${r.id}`, { body: { approve } });
      toast(approve ? `${money(r.amount)} заморожено для «${r.name}»` : 'Запрос отклонён', approve ? 'ok' : 'bad');
      onDecided?.(res);
    } catch (e) {
      toast(errorText(e), 'bad');
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: ['pulse'] });
      void qc.invalidateQueries({ queryKey: ['home'] });
    }
  };
  const short = r.available < r.amount;
  return (
    <>
      <div className="flex items-center gap-3">
        <PartnerIcon client={r.client} />
        <div className="min-w-0">
          <div className="text-[13px] text-muted">Подтвердите оплату</div>
          <div className="truncate text-lg font-semibold">{r.name}</div>
        </div>
      </div>
      <div className="mt-4 text-[32px] font-semibold leading-none num">{money(r.amount)}</div>
      <div className="mt-1 text-sm text-muted">{r.title}</div>
      <div className="mt-4 rounded-2xl bg-sunken px-4 py-3 text-sm">
        <div className="flex justify-between gap-3"><span className="text-muted">Счёт</span><span className="font-medium">{r.accountName} •• {r.accountLast4}</span></div>
        <div className="mt-1 flex justify-between gap-3"><span className="text-muted">Доступно</span><span className={short ? 'font-medium text-bad' : 'font-medium'}>{money(r.available)}</span></div>
      </div>
      <p className="mt-3 text-xs text-muted">Сумма больше лимита привязки, поэтому нужно ваше подтверждение. Деньги заморозятся до конца поездки; спишется точная цена, остаток вернётся. Осталось {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}.</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button size="lg" loading={busy === 'no'} disabled={!!busy} onClick={() => void answer(false)}>Отклонить</Button>
        <Button size="lg" variant="primary" loading={busy === 'yes'} disabled={!!busy || short || left === 0} onClick={() => void answer(true)}>Подтвердить</Button>
      </div>
    </>
  );
}

/** Opened from the partner's «Открыть Bobobank» link. */
export function ConfirmPartnerPage() {
  const [params] = useSearchParams();
  const id = params.get('id') ?? '';
  const nav = useNavigate();
  const { data, error, refetch } = useQuery({ queryKey: ['partner-request', id], queryFn: () => api<PartnerRequest>(`/partner-requests/${id}`), enabled: !!id, retry: false });
  const back = data?.returnUrl;
  let body;
  if (!id || error) body = <ErrorNote>{error ? errorText(error) : 'В ссылке нет номера запроса.'}</ErrorNote>;
  else if (!data) body = <Loading />;
  else if (data.status === 'pending') body = <Card><PartnerRequestCard r={data} onDecided={() => void refetch()} /></Card>;
  else {
    const ok = data.status === 'approved';
    body = (
      <Card className="text-center">
        {ok ? <CheckCircle2 className="mx-auto size-14 text-ok" /> : <XCircle className="mx-auto size-14 text-bad" />}
        <div className="mt-3 text-xl font-semibold">{ok ? 'Оплата подтверждена' : data.status === 'expired' ? 'Время вышло' : 'Запрос отклонён'}</div>
        <p className="mt-1 text-[15px] text-muted">{ok ? `${money(data.amount)} заморожено — возвращайтесь в «${data.name}».` : `«${data.name}» не получит эти деньги.`}</p>
        {back && <Button className="mt-5 w-full" size="lg" variant="primary" onClick={() => window.location.assign(back)}>Вернуться в {data.name}</Button>}
        <Button className="mt-2 w-full" variant="ghost" onClick={() => nav('/app')}>В Bobobank</Button>
      </Card>
    );
  }
  return (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <div className="mb-6 flex items-center justify-between"><Logo compact /><span className="text-sm text-muted">Подтверждение оплаты</span></div>
      {body}
    </div>
  );
}
