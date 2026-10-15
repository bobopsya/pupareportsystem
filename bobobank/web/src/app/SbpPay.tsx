import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Store } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AccountPicker } from '../components/AccountPicker';
import { Logo } from '../components/Logo';
import { SbpLogo } from '../components/PaymentLogos';
import { Success } from '../components/Success';
import { Button, Card, ErrorNote, Loading } from '../components/ui';
import { api, errorText } from '../lib/api';
import { money } from '../lib/format';
import { useHome, useRefresh } from '../lib/hooks';

interface P {
  id: string;
  status: string;
  amount: number;
  currency: string;
  description: string;
  merchant: { name: string; inn?: string; site?: string };
  return_url?: string | null;
}

/** Opened from the SBP QR code on a GPAY checkout: confirm and pay from a Bobobank account. */
export default function SbpPay() {
  const [params] = useSearchParams();
  const id = params.get('payment') ?? '';
  const method = params.get('method') === 'bobopay' ? 'bobopay' : 'sbp';
  const via = method === 'bobopay' ? 'Bobo Pay' : 'СБП';
  const nav = useNavigate();
  const refresh = useRefresh();
  const { data: home } = useHome();
  const { data, error } = useQuery({ queryKey: ['sbp', id], queryFn: () => api<{ payment: P }>(`/sbp/${id}`).then((r) => r.payment), enabled: !!id, retry: false });
  const accounts = useMemo(() => home?.accounts.filter((a) => a.currency === (data?.currency ?? 'RUB') && ['current', 'savings', 'business', 'credit_card', 'kids'].includes(a.kind)) ?? [], [home, data]);
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ entryId: number; returnUrl: string | null } | null>(null);
  useEffect(() => {
    if (!from && accounts.length) setFrom(accounts[0].id);
  }, [accounts, from]);

  const wrap = (children: ReactNode) => (
    <div className="mx-auto min-h-dvh max-w-md px-4 pb-10 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <div className="mb-6 flex items-center justify-between"><Logo compact />{method === 'sbp' ? <SbpLogo className="h-8 w-12 border border-line" /> : <span className="rounded-lg bg-brand px-2.5 py-1 text-sm font-semibold text-on-brand">Bobo Pay</span>}</div>
      {children}
    </div>
  );
  if (!id) return wrap(<ErrorNote>Ссылка без номера платежа. Отсканируйте QR-код ещё раз.</ErrorNote>);
  if (error) return wrap(<><ErrorNote>{errorText(error)}</ErrorNote><Button className="mt-4 w-full" onClick={() => nav('/app')}>В приложение</Button></>);
  if (!data || !home) return wrap(<Loading />);
  if (done) {
    return wrap(
      <Success
        title={`Оплачено через ${via}`}
        amount={money(data.amount, data.currency, { exact: true })}
        lines={[['Получатель', data.merchant.name], ['Назначение', data.description || 'Оплата заказа'], ['Через', method === 'sbp' ? 'Система быстрых платежей' : 'Bobo Pay']]}
        entryId={done.entryId}
        onDone={() => (done.returnUrl ? (window.location.href = done.returnUrl) : nav('/app', { replace: true }))}
      />,
    );
  }
  const pay = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ entryId: number; returnUrl: string | null }>(`/sbp/${id}/pay`, { body: { accountId: from, method } });
      refresh();
      setDone(r);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const payable = data.status === 'pending';
  return wrap(
    <>
      <Card className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-sunken"><Store className="size-7" /></span>
        <div className="mt-3 text-lg font-semibold">{data.merchant.name}</div>
        {data.merchant.site && <div className="text-sm text-muted">{data.merchant.site}</div>}
        <div className="mt-3 text-[38px] font-semibold leading-none num">{money(data.amount, data.currency, { exact: data.amount % 100 !== 0 })}</div>
        {data.description && <div className="mt-2 text-sm text-muted">{data.description}</div>}
      </Card>
      {payable ? (
        <Card className="mt-3 flex flex-col gap-3">
          <AccountPicker label="Списать со счёта" accounts={accounts} value={from} onChange={setFrom} />
          {err && <ErrorNote>{err}</ErrorNote>}
          <Button size="lg" variant="primary" loading={busy} disabled={!from} onClick={() => void pay()}>Оплатить {money(data.amount, data.currency, { exact: data.amount % 100 !== 0 })}</Button>
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted"><ShieldCheck className="size-4 text-brand" />Без комиссии · деньги придут продавцу мгновенно</p>
        </Card>
      ) : (
        <div className="mt-3"><ErrorNote>{data.status === 'succeeded' ? 'Этот заказ уже оплачен.' : 'Платёж больше нельзя оплатить.'}</ErrorNote></div>
      )}
      <Button className="mt-3 w-full" variant="ghost" onClick={() => nav('/app')}>Отмена</Button>
    </>,
  );
}
