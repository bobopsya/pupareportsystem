import { ArrowLeft, Check, Loader2, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PayLogo, SbpMark } from '../components/PaymentLogos';
import { QR } from '../components/QR';
import { Button, CopyButton, cx, Field, Input, Segmented } from '../components/ui';
import { api, errorText } from '../lib/api';
import { money } from '../lib/format';
import type { CheckoutData, PayResult, PublicPayment } from './types';

type Done = (r: PayResult, p: PublicPayment) => void;

async function start(id: string, body: object) {
  return api<{ result: PayResult; payment: PublicPayment }>(`/checkout/payments/${id}/async`, { body });
}

/** 0→1 progress of the simulated processing window. */
function useProgress(until: number | null, total: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return 0;
  return Math.min(1, Math.max(0, 1 - (until - now) / total));
}

function Steps({ steps, progress }: { steps: string[]; progress: number }) {
  const active = Math.min(steps.length - 1, Math.floor(progress * steps.length));
  return (
    <ol className="flex flex-col gap-3 text-[15px]">
      {steps.map((s, i) => (
        <li key={s} className={cx('flex items-center gap-2.5 transition-colors', i <= active ? 'text-fg' : 'text-faint')}>
          <span className={cx('flex size-5 items-center justify-center rounded-full border', i < active ? 'bg-ink border-ink text-on-ink' : i === active ? 'border-fg text-fg' : 'border-line-strong')}>
            {i < active ? <Check className="size-3" strokeWidth={3} /> : i === active ? <Loader2 className="size-3 animate-spin" /> : null}
          </span>
          {s}
        </li>
      ))}
    </ol>
  );
}

function Bar({ progress }: { progress: number }) {
  return (
    <div className="h-1.5 rounded-full bg-sunken overflow-hidden">
      <div className="h-full rounded-full bg-ink transition-[width] duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
    </div>
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

// ---------- SBP ----------
export function SbpPanel({ data, email, emailOk, onResult, onBack }: { data: CheckoutData; email: string; emailOk: boolean; onResult: Done; onBack: (p: PublicPayment) => void }) {
  const p = data.payment;
  const processing = p.action?.type === 'processing' && p.methodType === 'sbp' ? p.action.until : null;
  const progress = useProgress(processing, 9000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (processing) {
    return (
      <div className="flex flex-col items-center text-center gap-4 gp-fade-up">
        <div className="relative rounded-3xl bg-white p-5 ring-1 ring-line">
          <QR text={`${location.origin}/pay/${p.id}?sbp=${p.method?.sbp?.operationId ?? ''}`} className="size-44 sm:size-48" dark="#1d1d1b" />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex size-11 items-center justify-center rounded-xl bg-white shadow-card">
            <SbpMark className="size-7" />
          </span>
        </div>
        <div>
          <div className="font-semibold">Отсканируйте QR-код</div>
          <p className="text-sm text-muted mt-1 max-w-xs">Камерой телефона или в приложении вашего банка, затем подтвердите перевод {money(p.amount, p.currency)}</p>
        </div>
        <div className="w-full max-w-xs flex flex-col gap-3">
          <Bar progress={progress} />
          <div className="flex items-center justify-center gap-2 text-sm text-muted">
            <Loader2 className="size-3.5 animate-spin" /> {progress < 0.55 ? 'Ожидаем оплату в приложении банка…' : 'Банк подтверждает перевод…'}
          </div>
        </div>
        <div className="text-[11px] text-faint font-mono">ID операции СБП: {p.method?.sbp?.operationId}</div>
        <BackLink id={p.id} onBack={onBack} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-2xl bg-sunken p-5">
        <Smartphone className="size-5 mt-0.5 shrink-0" />
        <p className="text-[15px] text-muted">
          Оплата через Систему быстрых платежей без ввода данных карты. Покажем QR-код — отсканируйте его в приложении любого банка-участника СБП. Комиссия для покупателя — 0 ₽.
        </p>
      </div>
      {error && <p className="text-[13px] text-bad">{error}</p>}
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        loading={busy}
        icon={<span className="flex size-6 items-center justify-center rounded-md bg-white"><SbpMark className="size-4" /></span>}
        onClick={async () => {
          if (!emailOk) return setError('Проверьте email для чека');
          setBusy(true);
          setError(null);
          try {
            const r = await start(p.id, { type: 'sbp', email: email || undefined });
            onResult(r.result, r.payment);
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Оплатить через СБП
      </Button>
    </div>
  );
}

// ---------- Installments ----------
export function InstallmentsPanel({ data, email, emailOk, onResult, onBack }: { data: CheckoutData; email: string; emailOk: boolean; onResult: Done; onBack: (p: PublicPayment) => void }) {
  const p = data.payment;
  const processing = p.action?.type === 'processing' && p.methodType === 'installments' ? p.action.until : null;
  const progress = useProgress(processing, 11000);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const part = Math.ceil(p.amount / 4);
  const day = 24 * 3600 * 1000;
  const fmt = (ts: number) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(ts).replace('.', '');

  const schedule = (
    <div className="grid grid-cols-4 gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={cx('rounded-2xl border-[1.5px] px-2 py-3 text-center', i === 0 ? 'border-fg bg-surface' : 'border-transparent bg-sunken')}>
          <div className="mx-auto mb-1.5 size-6 rounded-full border-2 border-fg" style={{ background: `conic-gradient(var(--color-fg) ${(i + 1) * 25}%, transparent 0)` }} />
          <div className="text-[13px] font-semibold">{money(i === 3 ? p.amount - part * 3 : part, p.currency)}</div>
          <div className="text-[11px] text-muted">{i === 0 ? 'сегодня' : fmt(Date.now() + i * 14 * day)}</div>
        </div>
      ))}
    </div>
  );

  if (processing) {
    return (
      <div className="flex flex-col gap-5 gp-fade-up">
        {schedule}
        <Bar progress={progress} />
        <Steps steps={['Проверяем данные', 'Принимаем решение', 'Списываем первый платёж']} progress={progress} />
        <BackLink id={p.id} onBack={onBack} />
      </div>
    );
  }

  const digits = phone.replace(/\D/g, '');
  const fmtPhone = (d: string) => {
    const x = d.replace(/^[78]/, '').slice(0, 10);
    const parts = [x.slice(0, 3), x.slice(3, 6), x.slice(6, 8), x.slice(8, 10)];
    return `+7${parts[0] ? ` (${parts[0]}` : ''}${parts[0].length === 3 ? ')' : ''}${parts[1] ? ` ${parts[1]}` : ''}${parts[2] ? `-${parts[2]}` : ''}${parts[3] ? `-${parts[3]}` : ''}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-[15px] font-semibold">4 платежа без переплаты</div>
        <p className="text-sm text-muted mt-0.5">Сегодня — 25%, остальное раз в две недели. Без процентов и комиссий.</p>
      </div>
      {schedule}
      <Field label="Номер телефона" error={error}>
        <Input inputMode="tel" autoComplete="tel" placeholder="+7 (900) 000-00-00" value={phone ? fmtPhone(phone.replace(/\D/g, '')) : ''} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))} />
      </Field>
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        loading={busy}
        onClick={async () => {
          const d = digits.replace(/^[78]/, '');
          if (d.length !== 10) return setError('Введите номер телефона полностью');
          if (!emailOk) return setError('Проверьте email для чека');
          setBusy(true);
          setError(null);
          try {
            const r = await start(p.id, { type: 'installments', phone: `7${d}`, email: email || undefined });
            onResult(r.result, r.payment);
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Оформить и оплатить {money(part, p.currency)}
      </Button>
    </div>
  );
}

// ---------- Crypto ----------
export function CryptoPanel({ data, email, emailOk, onResult, onBack }: { data: CheckoutData; email: string; emailOk: boolean; onResult: Done; onBack: (p: PublicPayment) => void }) {
  const p = data.payment;
  const processing = p.action?.type === 'processing' && p.methodType === 'crypto' ? p.action.until : null;
  const progress = useProgress(processing, 14000);
  const [asset, setAsset] = useState<'USDT' | 'BTC'>('USDT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rubPer = p.currency === 'RUB' ? 1 : data.rates[p.currency as 'USD'];
  const approx = (a: 'USDT' | 'BTC') => {
    const v = ((p.amount / 100) * rubPer) / data.rates[a];
    return a === 'BTC' ? v.toFixed(8) : (Math.ceil(v * 100) / 100).toFixed(2);
  };

  if (processing && p.method?.crypto) {
    const c = p.method.crypto;
    const need = c.asset === 'BTC' ? 3 : 20;
    const conf = Math.max(0, Math.floor((progress - 0.35) / 0.65 * need));
    return (
      <div className="flex flex-col gap-4 gp-fade-up">
        <div className="flex gap-4 items-center">
          <div className="rounded-2xl bg-white p-3 ring-1 ring-line shrink-0">
            <QR text={c.asset === 'BTC' ? `bitcoin:${c.address}?amount=${c.amount}` : c.address} className="size-28" />
          </div>
          <div className="min-w-0 flex flex-col gap-2">
            <div className="text-sm text-muted">Отправьте ровно</div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-lg font-semibold">{c.amount} {c.asset}</span>
              <CopyButton text={c.amount} label="Скопировать сумму" />
            </div>
            <div className="text-xs text-muted">Сеть: {c.asset === 'BTC' ? 'Bitcoin' : 'TRON (TRC-20)'}</div>
          </div>
        </div>
        <div>
          <div className="text-sm text-muted mb-1.5">Адрес кошелька</div>
          <div className="flex items-center gap-1 rounded-xl bg-sunken pl-4 pr-1.5 h-12">
            <span className="flex-1 truncate font-mono text-[12px]">{c.address}</span>
            <CopyButton text={c.address} label="Скопировать адрес" />
          </div>
        </div>
        <Bar progress={progress} />
        <Steps steps={['Ожидаем транзакцию', `Подтверждения сети: ${Math.min(conf, need)}/${need}`, 'Зачисляем платёж']} progress={progress} />
        <p className="text-[11px] text-faint">Курс зафиксирован на 15 минут. Отправка другой суммы или в другой сети приведёт к потере средств.</p>
        <BackLink id={p.id} onBack={onBack} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Segmented
        value={asset}
        onChange={setAsset}
        className="w-full [&>button]:flex-1"
        options={[
          { value: 'USDT', label: <span className="inline-flex items-center gap-1.5"><PayLogo name="tether" className="!w-5 !h-5 !border-0 !bg-transparent" />USDT · TRC-20</span> },
          { value: 'BTC', label: <span className="inline-flex items-center gap-1.5"><PayLogo name="bitcoin" className="!w-5 !h-5 !border-0 !bg-transparent" />Bitcoin</span> },
        ]}
      />
      <div className="rounded-2xl bg-sunken px-5 py-4 flex items-center justify-between">
        <span className="text-sm text-muted">К оплате</span>
        <span className="font-mono font-semibold">≈ {approx(asset)} {asset}</span>
      </div>
      {error && <p className="text-[13px] text-bad">{error}</p>}
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        loading={busy}
        onClick={async () => {
          if (!emailOk) return setError('Проверьте email для чека');
          setBusy(true);
          setError(null);
          try {
            const r = await start(p.id, { type: 'crypto', asset, email: email || undefined });
            onResult(r.result, r.payment);
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Получить адрес для оплаты
      </Button>
    </div>
  );
}
