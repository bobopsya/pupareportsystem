import { useQuery } from '@tanstack/react-query';
import { ArrowDownUp, DollarSign, Euro } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccountPicker } from '../components/AccountPicker';
import { Screen } from '../components/Screen';
import { Success } from '../components/Success';
import { Button, Card, ErrorNote, Field, Input, Loading } from '../components/ui';
import { api, errorText } from '../lib/api';
import { money, toAmount } from '../lib/format';
import { useHome, useRefresh } from '../lib/hooks';
import { SectionTitle } from './Shell';

interface Board {
  board: { currency: 'USD' | 'EUR'; cb: number; buy: number; sell: number }[];
  updatedAt: number;
}

export default function Exchange() {
  const nav = useNavigate();
  const refresh = useRefresh();
  const { data: home } = useHome();
  const { data: fx } = useQuery({ queryKey: ['fx'], queryFn: () => api<Board>('/fx') });
  const accounts = useMemo(() => home?.accounts.filter((a) => a.kind === 'current' || a.kind === 'business') ?? [], [home]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<{ result: number; rate: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    if (!accounts.length || from) return;
    const rub = accounts.find((a) => a.currency === 'RUB');
    const foreign = accounts.find((a) => a.currency !== 'RUB');
    if (rub) setFrom(rub.id);
    if (foreign) setTo(foreign.id);
  }, [accounts, from]);
  const amt = toAmount(amount);
  useEffect(() => {
    setQuote(null);
    if (!from || !to || !amt) return;
    const t = setTimeout(() => void api<{ result: number; rate: number }>('/fx/quote', { body: { fromAccountId: from, toAccountId: to, amount: amt } }).then(setQuote, () => {}), 250);
    return () => clearTimeout(t);
  }, [from, to, amt]);

  if (!home || !fx) return <Loading />;
  const src = accounts.find((a) => a.id === from);
  const dst = accounts.find((a) => a.id === to);
  const hasForeign = accounts.some((a) => a.currency !== 'RUB');

  if (done !== null && src && dst) {
    return <Success title="Валюта обменяна" amount={money(done, dst.currency, { exact: true })} lines={[['Списано', money(Math.round(Number(amt) * 100), src.currency, { exact: true })], ['Курс', quote ? `1 ${dst.currency} = ${(1 / quote.rate).toFixed(2)} ${src.currency}` : '—']]} onDone={() => nav('/app', { replace: true })} />;
  }

  return (
    <Screen title="Обмен валют">
      <div className="grid grid-cols-2 gap-3">
        {fx.board.map((r) => (
          <Card key={r.currency} className="!p-4">
            <div className="flex items-center gap-2 font-semibold">{r.currency === 'USD' ? <DollarSign className="size-5 text-brand" /> : <Euro className="size-5 text-brand" />}{r.currency}</div>
            <div className="mt-2 grid grid-cols-2 gap-1 text-sm">
              <span className="text-muted">Покупка</span><span className="text-right font-semibold num">{r.buy.toFixed(2)}</span>
              <span className="text-muted">Продажа</span><span className="text-right font-semibold num">{r.sell.toFixed(2)}</span>
              <span className="text-muted">ЦБ</span><span className="text-right num">{r.cb.toFixed(2)}</span>
            </div>
          </Card>
        ))}
      </div>
      <SectionTitle>Обменять</SectionTitle>
      {!hasForeign ? (
        <Card>
          <p className="text-muted">Чтобы купить валюту, откройте счёт в долларах или евро.</p>
          <Button className="mt-4" variant="primary" onClick={() => nav('/app/accounts/new')}>Открыть валютный счёт</Button>
        </Card>
      ) : (
        <Card className="flex flex-col gap-3">
          <AccountPicker label="Продаю" accounts={accounts} value={from} onChange={setFrom} />
          <button type="button" aria-label="Поменять местами" onClick={() => (setFrom(to), setTo(from))} className="mx-auto inline-flex size-10 items-center justify-center rounded-full bg-sunken hover:bg-hover"><ArrowDownUp className="size-5" /></button>
          <AccountPicker label="Покупаю" accounts={accounts.filter((a) => a.id !== from)} value={to} onChange={setTo} />
          <Field label={`Сумма в ${src?.currency ?? ''}`}>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-[22px] font-semibold num" placeholder="0" />
          </Field>
          <div className="min-h-6 text-sm text-muted">{quote && dst ? <>Получите <b className="text-fg num">{money(quote.result, dst.currency, { exact: true })}</b></> : src && dst && src.currency === dst.currency ? 'Выберите счета в разных валютах' : ''}</div>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button size="lg" variant="primary" loading={busy} disabled={!quote} onClick={() => {
            setBusy(true);
            setError(null);
            api<{ result: number }>('/fx/exchange', { body: { fromAccountId: from, toAccountId: to, amount: amt } })
              .then((r) => (refresh(), setDone(r.result)))
              .catch((e) => setError(errorText(e)))
              .finally(() => setBusy(false));
          }}>Обменять</Button>
        </Card>
      )}
    </Screen>
  );
}
