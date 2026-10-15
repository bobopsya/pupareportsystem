import { ArrowLeft, ChevronDown, Clock, CreditCard, Lock, Receipt, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Logo, LogoMark } from '../components/Logo';
import { CardLogos, PayLogo, SbpMark } from '../components/PaymentLogos';
import { Button, cx, Field, Input, Loading } from '../components/ui';
import { api, ApiError, errorText } from '../lib/api';
import { dateTime, money, REASONS } from '../lib/format';
import { BankConfirm, BoboMark, BobopayPanel, SbpPanel } from './AsyncMethods';
import { CardForm } from './CardForm';
import { notifyParent, type CheckoutData, type MethodType, type PayResult, type PublicPayment, type PublicShop } from './types';

const METHOD_TABS: { type: MethodType; label: string; icon: ReactNode }[] = [
  { type: 'bank_card', label: 'Карта', icon: <CreditCard className="size-[18px]" /> },
  { type: 'sbp', label: 'СБП', icon: <SbpMark className="size-[18px]" /> },
  { type: 'bobopay', label: 'Bobo Pay', icon: <BoboMark className="size-[18px]" /> },
];

const emailValid = (e: string) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export function ShopAvatar({ shop, className }: { shop: Pick<PublicShop, 'name' | 'color'>; className?: string }) {
  return (
    <span className={cx('flex items-center justify-center rounded-xl font-semibold text-white shrink-0', className ?? 'size-10 text-base')} style={{ background: shop.color }}>
      {shop.name.trim()[0]?.toUpperCase()}
    </span>
  );
}

function useCountdown(to: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((to - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function CheckoutPage() {
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const embed = search.get('embed') === '1';
  const [data, setData] = useState<CheckoutData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<CheckoutData>(`/checkout/payments/${id}`));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'Платёж не найден. Проверьте ссылку или вернитесь в магазин.' : errorText(e));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (data) document.title = `Оплата · ${data.shop.name} — GPAY`;
  }, [data]);

  if (error) return <Frame embed={embed}><NotFound text={error} /></Frame>;
  if (!data) return <Frame embed={embed}><Loading /></Frame>;
  return <Checkout data={data} setData={setData} embed={embed} reload={load} />;
}

function Frame({ embed, children }: { embed: boolean; children: ReactNode }) {
  return <div className={cx('min-h-screen flex items-center justify-center', embed ? 'p-0' : 'p-4')}>{children}</div>;
}

function NotFound({ text }: { text: string }) {
  return (
    <div className="max-w-sm text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-bad-soft text-bad">
        <X className="size-6" />
      </div>
      <div className="font-semibold text-lg">Не удалось открыть оплату</div>
      <p className="text-sm text-muted mt-1">{text}</p>
      <div className="mt-6 flex justify-center"><Logo size="sm" /></div>
    </div>
  );
}

function Checkout({ data, setData, embed, reload }: { data: CheckoutData; setData: (d: CheckoutData) => void; embed: boolean; reload: () => Promise<void> }) {
  const p = data.payment;
  const shop = data.shop;
  const methods = METHOD_TABS.filter((m) => shop.methods.includes(m.type));
  const [method, setMethod] = useState<MethodType>(p.methodType ?? methods[0]?.type ?? 'bank_card');
  const [email, setEmail] = useState(p.customerEmail ?? '');
  const [emailTouched, setEmailTouched] = useState(false);
  const [declined, setDeclined] = useState<{ message: string; reason: string; canceled: boolean } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const countdown = useCountdown(p.expiresAt);

  const setPayment = useCallback((payment: PublicPayment) => setData({ ...data, payment }), [data, setData]);

  const onResult = (r: PayResult, payment: PublicPayment) => {
    setPayment(payment);
    if (r.result === 'declined') {
      setDeclined(r);
      notifyParent('fail', payment.id, { reason: r.reason });
    }
  };

  // Poll while an asynchronous method is being processed.
  const processing = p.status === 'pending' && (p.action?.type === 'processing' || p.action?.type === 'bank_confirm');
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => void reload(), 1000);
    return () => clearInterval(t);
  }, [processing, reload]);

  useEffect(() => {
    if (p.status === 'succeeded' || p.status === 'waiting_for_capture') notifyParent('success', p.id, { status: p.status });
    if (p.status === 'canceled') notifyParent('fail', p.id, { reason: p.cancellation?.reason });
  }, [p.status, p.id, p.cancellation?.reason]);

  const emailOk = emailValid(email);
  const final = p.status !== 'pending';

  const summary = <Summary data={data} />;

  let body: ReactNode;
  if (final) body = <ResultView data={data} embed={embed} />;
  else if (declined) body = <Declined declined={declined} attemptsLeft={p.attemptsLeft} onRetry={() => setDeclined(null)} onOther={() => { setDeclined(null); setMethod(methods.find((m) => m.type !== 'bank_card')?.type ?? 'bank_card'); }} />;
  else if (!shop.active) body = <p className="text-sm text-muted">Магазин временно не принимает платежи. Попробуйте позже.</p>;
  else {
    const lockMethod = processing ? p.methodType : null;
    body = (
      <div className="flex flex-col gap-5">
        {!lockMethod && (
          <Field label="Email для чека" error={emailTouched && !emailOk ? 'Проверьте адрес почты' : null} hint="Пришлём электронный чек по 54-ФЗ">
            <Input type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value.trim())} onBlur={() => setEmailTouched(true)} invalid={emailTouched && !emailOk} />
          </Field>
        )}
        {!lockMethod && methods.length > 1 && (
          <div>
            <div className="text-sm text-muted mb-2">Способ оплаты</div>
            <div role="tablist" className="grid gap-1 rounded-[14px] bg-sunken p-1" style={{ gridTemplateColumns: `repeat(${methods.length}, minmax(0, 1fr))` }}>
              {methods.map((m) => (
                <button
                  key={m.type}
                  type="button"
                  role="tab"
                  aria-selected={method === m.type}
                  onClick={() => setMethod(m.type)}
                  className={cx(
                    'flex items-center justify-center gap-1.5 rounded-[10px] h-11 px-2 text-sm font-medium transition-colors',
                    method === m.type ? 'bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.06)]' : 'text-muted hover:text-fg',
                  )}
                >
                  <span className="hidden sm:inline-flex">{m.icon}</span>
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div key={lockMethod ?? method} className="gp-fade-up">
          {lockMethod && p.action?.type === 'bank_confirm' && <BankConfirm data={data} onBack={setPayment} />}
          {!lockMethod && method === 'bank_card' && <CardForm data={data} email={email} emailOk={emailOk} onResult={(r, pay) => { setEmailTouched(true); onResult(r, pay); }} />}
          {!lockMethod && method === 'sbp' && <SbpPanel data={data} onBack={setPayment} />}
          {!lockMethod && method === 'bobopay' && <BobopayPanel data={data} email={email} emailOk={emailOk} onResult={onResult} onBack={setPayment} />}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <div className={cx('flex-1 w-full mx-auto grid grid-cols-1 md:grid-cols-[1fr_1.1fr] md:gap-6', embed ? '' : 'max-w-[1080px] md:py-10 md:px-6')}>
        {/* Order summary */}
        <aside className={cx('relative bg-sunken px-5 pt-5 pb-5 md:p-10 flex flex-col', embed ? 'md:rounded-none' : 'md:rounded-[32px]')}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {!embed && p.returnUrl && !final && (
                <a href={p.returnUrl} className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-fg" aria-label="Вернуться в магазин">
                  <ArrowLeft className="size-4" />
                </a>
              )}
              <ShopAvatar shop={shop} className="size-9 text-[15px]" />
              <div className="min-w-0">
                <div className="font-semibold truncate">{shop.name}</div>
                {shop.site && <div className="text-xs text-muted truncate">{shop.site.replace(/^https?:\/\//, '')}</div>}
              </div>
            </div>
            {embed && (
              <button type="button" className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-hover" aria-label="Закрыть" onClick={() => notifyParent('close', p.id)}>
                <X className="size-4" />
              </button>
            )}
          </div>

          <div className="mt-6 md:mt-10">
            <div className="text-[15px] text-muted">{p.description || 'Оплата заказа'}</div>
            <div className="mt-1 text-[36px] md:text-[44px] leading-tight font-bold tracking-[-0.03em]">{money(p.amount, p.currency, { exact: p.amount % 100 !== 0 })}</div>
            {!final && (
              <div className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted">
                <Clock className="size-3.5" /> Оплатите в течение <span className="tabular-nums">{countdown}</span>
              </div>
            )}
          </div>

          <div className="md:hidden mt-3">
            <button type="button" className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4" onClick={() => setSummaryOpen((o) => !o)}>
              {summaryOpen ? 'Скрыть детали' : 'Детали заказа'}
              <ChevronDown className={cx('size-4 transition-transform', summaryOpen && 'rotate-180')} />
            </button>
            {summaryOpen && <div className="mt-3 gp-fade-up">{summary}</div>}
          </div>
          <div className="hidden md:block mt-8">{summary}</div>

          <div className="hidden md:flex mt-auto pt-10 items-center gap-2 text-sm text-faint">
            <span>Работает на</span>
            <Logo size="sm" />
          </div>
        </aside>

        {/* Payment form */}
        <main className="bg-surface px-5 py-7 md:px-4 md:py-10 flex flex-col">
          <h1 className="text-[28px] font-bold leading-tight mb-6">{final ? 'Статус платежа' : 'Оплата'}</h1>
          {body}
          {!final && (
            <div className="mt-auto pt-8 flex flex-col gap-4">
              <div className="flex items-center gap-2 text-[13px] text-muted">
                <Lock className="size-4 shrink-0" />
                Данные защищены по стандарту PCI DSS. Магазин не получает реквизиты вашей карты.
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="inline-flex flex-wrap gap-1.5">
                  <CardLogos />
                  <PayLogo name="sbp" />
                </span>
                <span className="inline-flex items-center gap-1 text-[13px] text-faint">
                  <ShieldCheck className="size-3.5" /> 3-D Secure
                </span>
              </div>
            </div>
          )}
          <footer className="md:hidden mt-8 flex items-center justify-center gap-2 text-sm text-faint">
            Работает на <Logo size="sm" />
          </footer>
        </main>
      </div>

    </div>
  );
}

function Summary({ data }: { data: CheckoutData }) {
  const p = data.payment;
  return (
    <div className="flex flex-col gap-3">
      {p.items?.map((it, i) => (
        <div key={i} className="flex items-start justify-between gap-4 text-sm">
          <div className="min-w-0">
            <div className="truncate">{it.name}</div>
            {it.quantity !== 1 && <div className="text-xs text-muted">{it.quantity} × {money(it.price, p.currency)}</div>}
          </div>
          <div className="shrink-0 font-medium">{money(Math.round(it.price * it.quantity), p.currency)}</div>
        </div>
      ))}
      {p.items && <div className="border-t border-line" />}
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">Итого</span>
        <span className="font-semibold">{money(p.amount, p.currency, { exact: true })}</span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted">
        <dt>Получатель</dt>
        <dd className="text-right truncate">{data.shop.legalName}</dd>
        <dt>ИНН</dt>
        <dd className="text-right font-mono">{data.shop.inn}</dd>
        <dt>Номер платежа</dt>
        <dd className="text-right font-mono truncate">{p.id}</dd>
      </dl>
    </div>
  );
}

function Declined({ declined, attemptsLeft, onRetry, onOther }: { declined: { message: string; reason: string; canceled: boolean }; attemptsLeft: number; onRetry: () => void; onOther: () => void }) {
  return (
    <div className="flex flex-col items-center text-center py-4 gp-fade-up">
      <div className="flex size-16 items-center justify-center rounded-full bg-bad-soft text-bad">
        <X className="size-8" strokeWidth={2.5} />
      </div>
      <div className="mt-5 text-2xl font-bold">{REASONS[declined.reason] ?? 'Платёж не прошёл'}</div>
      <p className="mt-1 text-sm text-muted max-w-xs">{declined.message}</p>
      {!declined.canceled && (
        <>
          <div className="mt-6 flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <Button variant="primary" onClick={onRetry} icon={<RotateCcw className="size-4" />}>Попробовать снова</Button>
            <Button onClick={onOther}>Другой способ</Button>
          </div>
          <p className="mt-4 text-xs text-faint">Осталось попыток: {attemptsLeft}</p>
        </>
      )}
    </div>
  );
}

function ResultView({ data, embed }: { data: CheckoutData; embed: boolean }) {
  const p = data.payment;
  const ok = p.status === 'succeeded' || p.status === 'waiting_for_capture';
  // Back from the Bobobank app: the customer has already seen the success screen there, so go on to the shop sooner.
  const fromBank = new URLSearchParams(location.search).get('from') === 'bank';
  const [redirectIn, setRedirectIn] = useState<number | null>(ok && p.returnUrl && !embed ? (fromBank ? 3 : 10) : null);
  useEffect(() => {
    if (redirectIn === null) return;
    if (redirectIn <= 0) {
      location.href = p.returnUrl!;
      return;
    }
    const t = setTimeout(() => setRedirectIn((s) => (s === null ? null : s - 1)), 1000);
    return () => clearTimeout(t);
  }, [redirectIn, p.returnUrl]);

  const income = useMemo(() => p.receipts.find((r) => r.type === 'income'), [p.receipts]);

  if (!ok) {
    const reason = p.cancellation?.reason ?? '';
    return (
      <div className="flex flex-col items-center text-center py-6 gp-fade-up">
        <div className="flex size-16 items-center justify-center rounded-full bg-bad-soft text-bad">
          <X className="size-8" strokeWidth={2.5} />
        </div>
        <div className="mt-5 text-2xl font-bold">Платёж отменён</div>
        <p className="mt-1 text-sm text-muted max-w-xs">
          {reason === 'expired_on_confirmation' ? 'Время на оплату истекло. Вернитесь в магазин и оформите заказ заново.' : REASONS[reason] ?? 'Оплата не была завершена.'} Деньги не списаны.
        </p>
        {p.returnUrl && !embed && (
          <a href={p.returnUrl} className="mt-6">
            <Button>Вернуться в магазин</Button>
          </a>
        )}
      </div>
    );
  }

  const held = p.status === 'waiting_for_capture';
  return (
    <div className="flex flex-col items-center text-center py-2 gp-fade-up">
      <div className="gp-pop flex size-16 items-center justify-center rounded-full bg-ok-soft text-ok">
        <svg viewBox="0 0 24 24" className="size-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path className="gp-draw" d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <div className="mt-5 text-2xl font-bold">{held ? 'Средства зарезервированы' : 'Оплата прошла успешно'}</div>
      <p className="mt-1 text-sm text-muted max-w-xs">
        {held ? `${data.shop.name} подтвердит списание после проверки заказа.` : `${money(p.amount, p.currency, { exact: true })} — ${data.shop.name}`}
        {p.customerEmail && !held && <><br />Чек отправлен на {p.customerEmail}</>}
      </p>

      <dl className="mt-7 w-full rounded-2xl bg-sunken px-5 py-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm text-left">
        <dt className="text-muted">Сумма</dt>
        <dd className="text-right font-medium">{money(p.amount, p.currency, { exact: true })}</dd>
        {p.refunded > 0 && (
          <>
            <dt className="text-muted">Возвращено</dt>
            <dd className="text-right font-medium text-warn">{money(p.refunded, p.currency, { exact: true })}</dd>
          </>
        )}
        <dt className="text-muted">Способ</dt>
        <dd className="text-right">{p.method?.title}</dd>
        <dt className="text-muted">Дата</dt>
        <dd className="text-right">{dateTime(p.capturedAt ?? p.createdAt)}</dd>
        <dt className="text-muted">Номер</dt>
        <dd className="text-right font-mono text-xs truncate">{p.id}</dd>
      </dl>

      {!held && (
        <div className="mt-4 grid grid-cols-2 gap-2 w-full">
          {income && (
            <Link to={`/r/${income.id}`} target={embed ? '_blank' : undefined}>
              <Button className="w-full" icon={<Receipt className="size-4" />}>Кассовый чек</Button>
            </Link>
          )}
          <Link to={`/q/${p.id}`} target={embed ? '_blank' : undefined} className={income ? '' : 'col-span-2'}>
            <Button className="w-full" icon={<LogoMark className="size-4" />}>Квитанция</Button>
          </Link>
        </div>
      )}

      {p.returnUrl && !embed && (
        <div className="mt-5 w-full">
          <a href={p.returnUrl}>
            <Button variant="primary" size="lg" className="w-full">Вернуться в магазин</Button>
          </a>
          {redirectIn !== null && (
            <p className="mt-2 text-xs text-muted">
              Автоматический переход через {redirectIn} с ·{' '}
              <button type="button" className="underline underline-offset-4 text-fg" onClick={() => setRedirectIn(null)}>остаться</button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
