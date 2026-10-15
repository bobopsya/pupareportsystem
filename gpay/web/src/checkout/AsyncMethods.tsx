import { ArrowLeft, BellRing, ExternalLink, Loader2, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SbpMark } from '../components/PaymentLogos';
import { QR } from '../components/QR';
import { Button, Field, Input } from '../components/ui';
import { api, errorText } from '../lib/api';
import { money } from '../lib/format';
import type { CheckoutData, PayResult, PublicPayment } from './types';

type Done = (r: PayResult, p: PublicPayment) => void;

/** Bobobank's mark: two rings, white on green. */
export function BoboMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#21A038" />
      <rect x="15" y="12" width="7" height="34" rx="3.5" fill="#fff" />
      <circle cx="30" cy="38" r="9.5" fill="none" stroke="#fff" strokeWidth="7" />
      <circle cx="44" cy="38" r="9.5" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="7" />
    </svg>
  );
}

function BackLink({ id, onBack }: { id: string; onBack: (p: PublicPayment) => void }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"
      onClick={async () => onBack((await api<{ payment: PublicPayment }>(`/checkout/payments/${id}/reset`, { body: {} })).payment)}
    >
      <ArrowLeft className="size-3.5" /> Выбрать другой способ
    </button>
  );
}

/** Keeps the page in sync while the buyer pays in the Bobobank app in another tab or on the phone. */
function usePollPaid(id: string, onUpdate: (p: PublicPayment) => void) {
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const r = await api<{ payment: PublicPayment }>(`/checkout/payments/${id}`);
        if (r.payment.status !== 'pending') onUpdate(r.payment);
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [id, onUpdate]);
}

// ---------- SBP: the QR code opens the order in Bobobank ----------
export function SbpPanel({ data, onBack }: { data: CheckoutData; onBack: (p: PublicPayment) => void }) {
  const p = data.payment;
  usePollPaid(p.id, onBack);
  if (!p.sbpBankUrl || p.currency !== 'RUB') return <p className="text-sm text-muted">Оплата через СБП доступна только в рублях.</p>;
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-line p-5 text-center sm:flex-row sm:text-left">
      <div className="relative shrink-0 rounded-2xl bg-white p-3 ring-1 ring-line">
        <QR text={p.sbpBankUrl} className="size-40" dark="#0b3d26" />
        <span className="absolute left-1/2 top-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg bg-white shadow-card"><SbpMark className="size-7" /></span>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="font-semibold">Отсканируйте QR-код камерой телефона</div>
        <p className="text-sm text-muted">Откроется приложение Bobobank — подтвердите оплату {money(p.amount, p.currency)}. Страница обновится сама.</p>
        <a href={p.sbpBankUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-2 self-center rounded-xl bg-[#21A038] px-4 text-[15px] font-medium text-white hover:bg-[#1c8f32] sm:self-start">
          Открыть Bobobank <ExternalLink className="size-4" />
        </a>
      </div>
    </div>
  );
}

// ---------- Bobo Pay: a button into the bank, or a request to the buyer's phone ----------
export function BobopayPanel({ data, email, emailOk, onResult, onBack }: { data: CheckoutData; email: string; emailOk: boolean; onResult: Done; onBack: (p: PublicPayment) => void }) {
  const p = data.payment;
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  usePollPaid(p.id, onBack);
  const digits = phone.replace(/\D/g, '');
  const request = async () => {
    if (!emailOk) return setError('Проверьте email для чека');
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ result: PayResult; payment: PublicPayment }>(`/checkout/payments/${p.id}/bobopay`, { body: { phone: digits, email: email || undefined } });
      onResult(r.result, r.payment);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      {p.bobopayUrl && (
        <a href={p.bobopayUrl} className="flex h-14 items-center justify-center gap-2.5 rounded-xl bg-[#21A038] text-[17px] font-semibold text-white hover:bg-[#1c8f32]">
          <BoboMark className="size-7" /> Bobo Pay
        </a>
      )}
      <div className="flex items-center gap-3 text-xs text-faint"><span className="h-px flex-1 bg-line" />или запрос в приложение по номеру<span className="h-px flex-1 bg-line" /></div>
      <Field label="Номер телефона в Bobobank" error={error}>
        <Input inputMode="tel" autoComplete="tel" placeholder="+7 900 000-00-00" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Button variant="secondary" size="lg" loading={busy} disabled={digits.length < 10} icon={<Smartphone className="size-5" />} onClick={() => void request()}>
        Отправить запрос в приложение
      </Button>
    </div>
  );
}

/** The buyer confirms in the Bobobank app (card purchase or Bobo Pay request); the page waits and polls. */
export function BankConfirm({ data, onBack }: { data: CheckoutData; onBack: (p: PublicPayment) => void }) {
  const p = data.payment;
  const until = p.action?.type === 'bank_confirm' ? p.action.until : Date.now();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.round((until - now) / 1000));
  const viaPhone = p.methodType === 'bobopay';
  return (
    <div className="flex flex-col items-center text-center gap-5 py-4 gp-fade-up">
      <div className="relative flex size-16 items-center justify-center rounded-full bg-[#e6f5e9] text-[#17802c]">
        <span className="absolute inset-0 rounded-full bg-[#21A038]/25 animate-ping" />
        <BellRing className="relative size-7" />
      </div>
      <div>
        <div className="text-xl font-bold">{viaPhone ? 'Подтвердите оплату в приложении Bobobank' : 'Подтвердите покупку в приложении Bobobank'}</div>
        <p className="mt-1 text-[15px] text-muted max-w-sm">
          {viaPhone ? `Мы отправили запрос на ${money(p.amount, p.currency)} на номер ${p.method?.phone ?? ''}.` : `Мы отправили запрос на ${money(p.amount, p.currency)} по карте ${p.method?.title}.`} Откройте Bobobank и нажмите «Подтвердить».
        </p>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted tabular-nums">
        <Loader2 className="size-3.5 animate-spin" /> Ждём подтверждения · {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
      </div>
      <BackLink id={p.id} onBack={onBack} />
    </div>
  );
}
