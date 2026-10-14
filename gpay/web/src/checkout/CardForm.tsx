import { CreditCard, Info, Lock } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PayLogo } from '../components/PaymentLogos';
import { Button, cx } from '../components/ui';
import { api, ApiError, errorText } from '../lib/api';
import { brandOf, formatPan, luhn, sha256 } from '../lib/cards';
import { money } from '../lib/format';
import type { CheckoutData, PayResult, PublicPayment } from './types';

let hashesPromise: Promise<Set<string>> | null = null;
/** Game card hashes; a number outside the list never leaves the browser. */
const loadHashes = () => (hashesPromise ??= api<{ hashes: string[] }>('/checkout/cards').then((r) => new Set(r.hashes)));

const BRAND_NAME = { visa: 'Visa', mastercard: 'Mastercard', mir: 'МИР', unionpay: 'UnionPay' } as const;

export function CardForm({ data, email, emailOk, onResult }: { data: CheckoutData; email: string; emailOk: boolean; onResult: (r: PayResult, p: PublicPayment) => void }) {
  const [pan, setPan] = useState('');
  const [exp, setExp] = useState('');
  const [csc, setCsc] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shaking, setShaking] = useState(false);
  // Restart the shake animation without remounting the inputs (that would drop focus and close the phone keyboard).
  const shake = () => {
    setShaking(false);
    requestAnimationFrame(() => setShaking(true));
    setTimeout(() => setShaking(false), 450);
  };
  const expRef = useRef<HTMLInputElement>(null);
  const cscRef = useRef<HTMLInputElement>(null);

  useEffect(() => void loadHashes(), []);

  const brand = brandOf(pan);
  const supported = brand && brand !== 'amex' && brand !== 'jcb';
  const panComplete = pan.length >= 16;

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!pan) e.pan = 'Введите номер карты';
    else if (brand === 'amex' || brand === 'jcb') e.pan = 'Карты этой платёжной системы не принимаются';
    else if (pan.length < 16 || !luhn(pan)) e.pan = 'Проверьте номер карты';
    const m = /^(\d{2})\/(\d{2})$/.exec(exp);
    if (!m) e.exp = 'Введите срок действия';
    else {
      const mm = Number(m[1]);
      const yy = 2000 + Number(m[2]);
      const now = new Date();
      if (mm < 1 || mm > 12) e.exp = 'Неверный месяц';
      else if (yy < now.getFullYear() || (yy === now.getFullYear() && mm < now.getMonth() + 1)) e.exp = 'Срок действия карты истёк';
      else if (yy > now.getFullYear() + 15) e.exp = 'Проверьте срок действия';
    }
    if (!/^\d{3}$/.test(csc)) e.csc = 'Три цифры на обороте';
    return e;
  }, [pan, exp, csc, brand]);

  const onPan = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 16);
    setPan(d);
    setError(null);
    if (d.length === 16 && luhn(d)) expRef.current?.focus();
  };
  const onExp = (v: string) => {
    let d = v.replace(/\D/g, '').slice(0, 4);
    if (d.length === 1 && Number(d) > 1) d = `0${d}`;
    setExp(d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d);
    if (d.length === 4) cscRef.current?.focus();
  };

  const submit = async () => {
    setTouched({ pan: true, exp: true, csc: true, email: true });
    setError(null);
    if (Object.keys(errors).length || !emailOk) {
      shake();
      return;
    }
    setBusy(true);
    try {
      const hashes = await loadHashes();
      if (!hashes.has(await sha256(pan))) {
        setError('Карта не поддерживается. Выберите другую карту или способ оплаты.');
        shake();
        return;
      }
      const [mm, yy] = exp.split('/');
      // Small pause so the button state is visible, like a real authorization round-trip.
      const [r] = await Promise.all([
        api<{ result: PayResult; payment: PublicPayment }>(`/checkout/payments/${data.payment.id}/card`, { body: { pan, expMonth: Number(mm), expYear: 2000 + Number(yy), csc, email: email || undefined } }),
        new Promise((res) => setTimeout(res, 900)),
      ]);
      onResult(r.result, r.payment);
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'card_not_supported' ? 'Карта не поддерживается. Выберите другую карту или способ оплаты.' : errorText(e));
      shake();
    } finally {
      setBusy(false);
    }
  };

  const show = (k: string) => touched[k] && errors[k];
  const shownError = error ?? (show('pan') || show('exp') || show('csc') || null);
  const message = shownError
    ? { tone: 'bad', text: shownError }
    : busy
      ? { tone: 'muted', text: 'Проверяем карту…' }
      : panComplete && supported && !errors.pan
        ? { tone: 'muted', text: `${BRAND_NAME[brand]} · карта будет проверена банком-эмитентом` }
        : { tone: 'muted', text: '' };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      <div className={cx('rounded-[14px] border-[1.5px] bg-sunken transition-colors focus-within:bg-surface', shaking && 'gp-shake', show('pan') || show('exp') || show('csc') || error ? 'border-bad' : 'border-transparent focus-within:border-fg')}>
        <div className="relative">
          <label htmlFor="cc-number" className="sr-only">Номер карты</label>
          <input
            id="cc-number"
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="Номер карты"
            value={formatPan(pan)}
            onChange={(e) => onPan(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, pan: true }))}
            className="w-full h-14 bg-transparent pl-4 min-[360px]:pl-11 pr-[60px] text-base min-[360px]:text-[17px] tabular-nums placeholder:text-faint focus:outline-none"
          />
          <CreditCard className="hidden min-[360px]:block absolute left-3.5 top-1/2 -translate-y-1/2 size-[18px] text-faint pointer-events-none" />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 transition-opacity" style={{ opacity: supported ? 1 : 0 }}>
            {supported && <PayLogo name={brand} />}
          </span>
        </div>
        <div className="grid grid-cols-2 border-t-[1.5px] border-bg">
          <div className="border-r-[1.5px] border-bg">
            <label htmlFor="cc-exp" className="sr-only">Срок действия</label>
            <input
              id="cc-exp"
              ref={expRef}
              inputMode="numeric"
              autoComplete="cc-exp"
              placeholder="ММ / ГГ"
              value={exp}
              onChange={(e) => onExp(e.target.value)}
              onKeyDown={(e) => e.key === 'Backspace' && exp.endsWith('/') && (e.preventDefault(), setExp(exp.slice(0, 1)))}
              onBlur={() => setTouched((t) => ({ ...t, exp: true }))}
              className="w-full h-14 bg-transparent px-4 text-[17px] tabular-nums placeholder:text-faint focus:outline-none"
            />
          </div>
          <div className="relative">
            <label htmlFor="cc-csc" className="sr-only">CVC / CVV</label>
            <input
              id="cc-csc"
              ref={cscRef}
              inputMode="numeric"
              autoComplete="cc-csc"
              type="password"
              placeholder="CVC"
              value={csc}
              onChange={(e) => setCsc(e.target.value.replace(/\D/g, '').slice(0, 3))}
              onBlur={() => setTouched((t) => ({ ...t, csc: true }))}
              className="w-full h-14 bg-transparent pl-4 pr-10 text-[17px] tabular-nums tracking-[0.2em] placeholder:tracking-normal placeholder:text-faint focus:outline-none"
            />
            <span className="group absolute right-3 top-1/2 -translate-y-1/2 text-faint" tabIndex={0} aria-label="Что такое CVC">
              <Info className="size-4" />
              <span className="pointer-events-none absolute bottom-7 right-[-8px] w-52 rounded-lg bg-ink text-on-ink text-[13px] p-3 opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity shadow-pop">
                Три цифры на обратной стороне карты, рядом с полосой для подписи
              </span>
            </span>
          </div>
        </div>
      </div>
      {/* One reserved line for errors and hints, so the pay button never moves. */}
      <p className={cx('-mt-2 min-h-10 text-[13px] leading-5', message.tone === 'bad' ? 'text-bad' : 'text-muted')} aria-live="polite">
        {message.text}
      </p>

      <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full -mt-1" icon={!busy && <Lock className="size-4" />}>
        Оплатить {money(data.payment.amount, data.payment.currency)}
      </Button>
    </form>
  );
}
