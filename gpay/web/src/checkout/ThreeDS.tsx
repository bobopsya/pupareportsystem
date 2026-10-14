import { Landmark, MessageSquare, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, cx } from '../components/ui';
import { api, errorText } from '../lib/api';
import { dateTime, money } from '../lib/format';
import type { CheckoutData, PayResult, PublicPayment } from './types';

/** Simulated issuer ACS page ("GPAY Bank") with an SMS banner carrying the one-time code. */
export function ThreeDS({ data, card, attemptsLeft, onResult }: { data: CheckoutData; card: string; attemptsLeft: number; onResult: (r: PayResult, p: PublicPayment) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sms, setSms] = useState(false);
  const [resendIn, setResendIn] = useState(45);
  const [smsKey, setSmsKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const p = data.payment;

  useEffect(() => {
    const t = setTimeout(() => setSms(true), 1400);
    const h = setTimeout(() => setSms(false), 12_000);
    return () => {
      clearTimeout(t);
      clearTimeout(h);
    };
  }, [smsKey]);
  useEffect(() => {
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => inputRef.current?.focus(), []);

  const send = async (value: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ result: PayResult; payment: PublicPayment }>(`/checkout/payments/${p.id}/3ds`, { body: { code: value } });
      if (r.result.result === '3ds') {
        setError(`Неверный код. Осталось попыток: ${r.result.attemptsLeft}`);
        setCode('');
        inputRef.current?.focus();
      } else onResult(r.result, r.payment);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const last4 = card.slice(-4);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
      {sms && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 w-[min(94vw,380px)] gp-fade-up z-[60]">
          <div className="flex gap-3 rounded-2xl bg-[rgb(245_245_250/0.92)] dark:bg-[rgb(40_40_52/0.92)] backdrop-blur-xl shadow-pop px-3.5 py-3 border border-white/40">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[#34c759] text-white">
              <MessageSquare className="size-5 fill-white" />
            </div>
            <div className="min-w-0 text-[13px] leading-snug text-[#111] dark:text-[#f2f2f7]">
              <div className="flex justify-between gap-2">
                <b>GPAY Bank</b>
                <span className="text-[11px] opacity-60">сейчас</span>
              </div>
              Код <b className="tabular-nums tracking-wide">123456</b> для покупки {money(p.amount, p.currency)} в {data.shop.name}. Карта *{last4}. Никому не сообщайте код.
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-[400px] rounded-3xl bg-white text-[#111] shadow-pop overflow-hidden gp-fade-up" role="dialog" aria-modal="true" aria-label="Подтверждение покупки">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#ececf2]">
          <div className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-[#111] text-white">
              <Landmark className="size-4" />
            </span>
            GPAY Bank
          </div>
          <div className="flex items-center gap-1 text-[11px] font-semibold text-[#5e6178]">
            <ShieldCheck className="size-4 text-[#1d5fd6]" /> {card.startsWith('МИР') ? 'Mir Accept' : card.startsWith('Mastercard') ? 'ID Check' : 'Visa Secure'}
          </div>
        </div>
        <div className="px-5 pt-5 pb-6">
          <h2 className="text-xl font-bold">Подтверждение покупки</h2>
          <p className="text-[13px] text-[#5e6178] mt-1">Мы отправили SMS с одноразовым кодом на номер <span className="whitespace-nowrap">+7 *** ***-**-47</span></p>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px] rounded-2xl bg-[#f2f3f5] px-4 py-3">
            <dt className="text-[#5e6178]">Магазин</dt>
            <dd className="text-right font-medium truncate">{data.shop.name}</dd>
            <dt className="text-[#5e6178]">Сумма</dt>
            <dd className="text-right font-medium">{money(p.amount, p.currency, { exact: true })}</dd>
            <dt className="text-[#5e6178]">Дата</dt>
            <dd className="text-right">{dateTime(Date.now())}</dd>
            <dt className="text-[#5e6178]">Карта</dt>
            <dd className="text-right tabular-nums">{card}</dd>
          </dl>
          <form
            className="mt-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.length === 6) void send(code);
            }}
          >
            <label htmlFor="otp" className="text-[13px] font-medium text-[#5e6178]">Код из SMS</label>
            <input
              id="otp"
              ref={inputRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              maxLength={6}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                setCode(v);
                if (v.length === 6) void send(v);
              }}
              className={cx('mt-1.5 w-full h-14 rounded-xl border-[1.5px] text-center text-[26px] font-semibold tabular-nums tracking-[0.4em] focus:outline-none', error ? 'border-[#d6293a] bg-[#fcebed]' : 'border-transparent bg-[#f2f3f5] focus:bg-white focus:border-[#111]')}
            />
            {error && <p className="mt-2 text-[13px] text-[#d92d3a]">{error}</p>}
            <Button type="submit" variant="dark" size="lg" loading={busy} disabled={code.length !== 6} className="w-full mt-4 !bg-[#111] !text-white">
              Подтвердить
            </Button>
          </form>
          <div className="mt-4 flex items-center justify-between text-[13px]">
            <button
              type="button"
              disabled={resendIn > 0}
              onClick={() => {
                setResendIn(45);
                setSms(false);
                setSmsKey((k) => k + 1);
              }}
              className="text-[#1d5fd6] disabled:text-[#8e91a6]"
            >
              {resendIn > 0 ? `Отправить код повторно через ${resendIn} с` : 'Отправить код повторно'}
            </button>
            <button type="button" className="text-[#5e6178] hover:text-[#14142b]" onClick={() => void send(null)} disabled={busy}>
              Отмена
            </button>
          </div>
          <p className="mt-5 text-[11px] text-[#8e91a6]">Попыток ввода кода: {attemptsLeft}. Не сообщайте код никому, в том числе сотрудникам банка.</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
