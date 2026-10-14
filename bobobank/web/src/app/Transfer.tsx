import { BadgeCheck, Info } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AccountPicker } from '../components/AccountPicker';
import { Initials } from '../components/CategoryIcon';
import { Screen } from '../components/Screen';
import { Success } from '../components/Success';
import { Button, Card, ErrorNote, Field, Input, Loading, Spinner } from '../components/ui';
import { api, errorText } from '../lib/api';
import { formatPan, formatPhoneInput, money, phoneDigits, toAmount } from '../lib/format';
import { useHome, useMeta, useRefresh } from '../lib/hooks';

type Kind = 'phone' | 'card' | 'account' | 'own';
interface Quote {
  display: string;
  subtitle: string;
  bank: string;
  own: boolean;
  fee: number;
  available: number;
  credited: { amount: number; currency: string; rate: number } | null;
}

const TITLE: Record<Kind, string> = { phone: 'По номеру телефона', card: 'По номеру карты', account: 'По реквизитам', own: 'Между своими счетами' };
const SPENDABLE = ['current', 'savings', 'business', 'credit_card', 'kids'];

export default function Transfer() {
  const { type = 'phone' } = useParams() as { type: Kind };
  const [params] = useSearchParams();
  const nav = useNavigate();
  const refresh = useRefresh();
  const { data: home } = useHome();
  const { data: meta } = useMeta();
  const accounts = useMemo(() => home?.accounts.filter((a) => SPENDABLE.includes(a.kind)) ?? [], [home]);
  const [from, setFrom] = useState(params.get('from') ?? '');
  const [phone, setPhone] = useState(params.get('phone') ? formatPhoneInput(params.get('phone')!) : '');
  const [pan, setPan] = useState('');
  const [to, setTo] = useState(params.get('to') ?? '');
  const [req, setReq] = useState({ number: '', bik: '', name: '', inn: '', purpose: '' });
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ entryId: number; fee: number; to: string } | null>(null);

  useEffect(() => {
    if (!from && accounts.length) setFrom((accounts.find((a) => a.id !== to && a.kind === 'current') ?? accounts[0]).id);
  }, [accounts, from, to]);
  useEffect(() => {
    if (type === 'account' && meta && !req.bik) setReq((r) => ({ ...r, bik: meta.bank.bik }));
  }, [type, meta, req.bik]);

  const recipient = useMemo(() => {
    if (type === 'phone') return phoneDigits(phone).length === 11 ? { type, phone } : null;
    if (type === 'card') return phoneDigits(pan).length >= 16 ? { type, pan: phoneDigits(pan) } : null;
    if (type === 'own') return to ? { type, accountId: to } : null;
    return req.number.replace(/\D/g, '').length === 20 && req.bik.length === 9 && req.name.trim().length > 1 ? { type, number: req.number.replace(/\D/g, ''), bik: req.bik, name: req.name, inn: req.inn || undefined, purpose: req.purpose || undefined } : null;
  }, [type, phone, pan, to, req]);
  const amt = toAmount(amount);

  // Recipient check (name, bank) and fee, like "Мария С. · Bobobank" before sending.
  useEffect(() => {
    setQuote(null);
    setQErr(null);
    if (!recipient || !from) return;
    let alive = true;
    setChecking(true);
    const t = setTimeout(() => {
      api<Quote>('/transfers/quote', { body: { fromAccountId: from, recipient, amount: amt ?? undefined } })
        .then((q) => alive && setQuote(q))
        .catch((e) => alive && setQErr(errorText(e)))
        .finally(() => alive && setChecking(false));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [recipient, from, amt]);

  if (!home) return <Loading />;
  const src = accounts.find((a) => a.id === from);
  const cur = src?.currency ?? 'RUB';
  const submit = async () => {
    if (!recipient || !amt) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ entryId: number; fee: number; to: string }>('/transfers', { body: { fromAccountId: from, recipient, amount: amt, comment: comment || undefined } });
      refresh();
      setDone(r);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Success
        title={type === 'own' ? 'Деньги переведены' : 'Перевод отправлен'}
        amount={money(Math.round(Number(amt) * 100), cur, { exact: true })}
        lines={[
          ['Получатель', done.to],
          ['Списано со счёта', `${src?.name} •• ${src?.number.slice(-4)}`],
          ['Комиссия', done.fee ? money(done.fee, cur, { exact: true }) : 'Без комиссии'],
          ...(comment ? [['Сообщение', comment] as [string, string]] : []),
        ]}
        entryId={done.entryId}
        onDone={() => nav('/app', { replace: true })}
      />
    );
  }

  const insufficient = quote && amt && Math.round(Number(amt) * 100) + quote.fee > quote.available;
  return (
    <Screen title={TITLE[type]}>
      <Card className="flex flex-col gap-4">
        <AccountPicker label="Откуда" accounts={accounts} value={from} onChange={setFrom} />
        {type === 'phone' && (
          <Field label="Номер телефона получателя">
            <Input inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(formatPhoneInput(e.target.value))} placeholder="+7 900 000-00-00" />
          </Field>
        )}
        {type === 'card' && (
          <Field label="Номер карты Bobobank">
            <Input inputMode="numeric" autoComplete="off" value={pan} onChange={(e) => setPan(formatPan(e.target.value))} placeholder="0000 0000 0000 0000" className="num" />
          </Field>
        )}
        {type === 'own' && <AccountPicker label="Куда" accounts={home.accounts.filter((a) => a.id !== from && ['current', 'savings', 'business', 'credit_card', 'kids'].includes(a.kind))} value={to} onChange={setTo} />}
        {type === 'account' && (
          <>
            <Field label="Получатель" hint="ФИО или название организации"><Input value={req.name} onChange={(e) => setReq({ ...req, name: e.target.value })} /></Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Счёт получателя"><Input inputMode="numeric" className="num" value={req.number} onChange={(e) => setReq({ ...req, number: e.target.value.replace(/\D/g, '').slice(0, 20) })} placeholder="20 цифр" /></Field>
              <Field label="БИК банка"><Input inputMode="numeric" className="num" value={req.bik} onChange={(e) => setReq({ ...req, bik: e.target.value.replace(/\D/g, '').slice(0, 9) })} /></Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="ИНН получателя" hint="Для организаций и ИП"><Input inputMode="numeric" value={req.inn} onChange={(e) => setReq({ ...req, inn: e.target.value.replace(/\D/g, '').slice(0, 12) })} /></Field>
              <Field label="Назначение платежа"><Input value={req.purpose} maxLength={210} onChange={(e) => setReq({ ...req, purpose: e.target.value })} placeholder="Оплата по счёту №…" /></Field>
            </div>
          </>
        )}

        {/* Reserved line: recipient check never shifts the form. */}
        <div className="min-h-[60px]">
          {checking && <div className="flex items-center gap-2 py-3 text-sm text-muted"><Spinner className="size-4" />Проверяем получателя…</div>}
          {!checking && quote && !quote.own && (
            <div className="flex items-center gap-3 rounded-2xl bg-brand-soft px-3 py-2.5">
              <Initials name={quote.display} className="size-10 text-sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{quote.display}</div>
                <div className="flex items-center gap-1 text-xs text-muted">{quote.bank === 'Bobobank' && <BadgeCheck className="size-3.5 text-brand" />}{quote.bank}</div>
              </div>
            </div>
          )}
          {!checking && qErr && <ErrorNote>{qErr}</ErrorNote>}
        </div>

        <Field label="Сумма" error={insufficient ? 'Недостаточно средств' : null}>
          <div className="relative">
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,\s]/g, ''))} placeholder="0" className="pr-12 text-[22px] font-extrabold num" invalid={!!insufficient} />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xl font-bold text-muted">{cur === 'RUB' ? '₽' : cur === 'USD' ? '$' : '€'}</span>
          </div>
        </Field>
        {type !== 'own' && type !== 'account' && (
          <Field label="Сообщение получателю"><Input value={comment} maxLength={140} onChange={(e) => setComment(e.target.value)} placeholder="Необязательно" /></Field>
        )}
        <div className="flex items-start gap-2 text-sm text-muted">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>
            {quote?.fee ? `Комиссия ${money(quote.fee, cur, { exact: true })} — превышен бесплатный лимит переводов в месяц.` : 'Без комиссии.'}
            {quote?.credited && ` Получатель получит ${money(quote.credited.amount, quote.credited.currency, { exact: true })}.`}
          </span>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button size="lg" variant="primary" loading={busy} disabled={!quote || !amt || !!insufficient} onClick={() => void submit()}>
          {amt ? `Перевести ${money(Math.round(Number(amt) * 100) + (quote?.fee ?? 0), cur, { exact: true })}` : 'Перевести'}
        </Button>
      </Card>
    </Screen>
  );
}
