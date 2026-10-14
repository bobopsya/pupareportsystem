import { ArrowRight, CalendarClock, FileText, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { CardLogos, PayLogo } from '../components/PaymentLogos';
import { Button, Card, Field, Input, Loading } from '../components/ui';
import { api, errorText } from '../lib/api';
import { CURRENCY_SYMBOL, longDate, money, toAmount } from '../lib/format';
import { ShopAvatar } from './Checkout';
import type { PublicShop } from './types';

interface LinkData {
  link: {
    slug: string;
    kind: 'link' | 'invoice';
    title: string;
    description: string;
    amount: number | null;
    minAmount: number;
    maxAmount: number;
    currency: string;
    state: 'active' | 'paid' | 'expired' | 'disabled';
    expiresAt: number | null;
    items: { name: string; quantity: number; price: number }[] | null;
    customer: { email?: string; name?: string } | null;
  };
  shop: PublicShop;
}

export default function LinkPage() {
  const { slug = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [data, setData] = useState<LinkData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    api<LinkData>(`/checkout/links/${slug}`).then(setData, (e) => setError(errorText(e)));
  }, [slug]);
  useEffect(() => {
    if (data) document.title = `${data.link.title} · ${data.shop.name} — GPAY`;
  }, [data]);

  if (error) return <Center><Unavailable title="Ссылка не найдена" text={error} /></Center>;
  if (!data) return <Center><Loading /></Center>;
  const { link, shop } = data;

  const go = async () => {
    setFormError(null);
    let value: string | undefined;
    if (!link.amount) {
      const v = toAmount(amount);
      if (!v) return setFormError('Введите сумму');
      const minor = Math.round(Number(v) * 100);
      if (minor < link.minAmount || minor > link.maxAmount) return setFormError(`Сумма от ${money(link.minAmount, link.currency)} до ${money(link.maxAmount, link.currency)}`);
      value = v;
    }
    setBusy(true);
    try {
      const r = await api<{ paymentId: string }>(`/checkout/links/${slug}/pay`, { body: { amount: value } });
      navigate(`/pay/${r.paymentId}${search.get('embed') === '1' ? '?embed=1' : ''}`);
    } catch (e) {
      setFormError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (link.state !== 'active') {
    return (
      <Center>
        <Unavailable
          title={link.state === 'paid' ? 'Счёт уже оплачен' : link.state === 'expired' ? 'Срок действия ссылки истёк' : 'Ссылка отключена'}
          text={link.state === 'paid' ? `Спасибо! Оплата «${link.title}» получена магазином ${shop.name}.` : `Обратитесь в ${shop.name}, чтобы получить новую ссылку на оплату.`}
          ok={link.state === 'paid'}
        />
      </Center>
    );
  }

  return (
    <Center>
      <div className="w-full max-w-[440px]">
        <div className="flex items-center gap-3 mb-5 px-1">
          <ShopAvatar shop={shop} />
          <div className="min-w-0">
            <div className="font-semibold truncate">{shop.name}</div>
            <div className="text-xs text-muted truncate">{shop.legalName} · ИНН {shop.inn}</div>
          </div>
        </div>
        <Card className="!p-8 !border-0 bg-surface">
          <div className="flex items-center gap-2 text-sm text-muted">
            <FileText className="size-3.5" /> {link.kind === 'invoice' ? 'Счёт на оплату' : 'Оплата'}
          </div>
          <h1 className="mt-2 text-2xl font-bold">{link.title}</h1>
          {link.description && <p className="mt-1 text-sm text-muted whitespace-pre-line">{link.description}</p>}
          {link.customer?.name && <p className="mt-2 text-sm">Плательщик: {link.customer.name}</p>}

          {link.items && (
            <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4">
              {link.items.map((it, i) => (
                <div key={i} className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{it.name}{it.quantity !== 1 && <span className="text-muted"> × {it.quantity}</span>}</span>
                  <span className="font-medium">{money(Math.round(it.price * it.quantity), link.currency)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-5">
            {link.amount ? (
              <div className="flex items-baseline justify-between border-t border-line pt-4">
                <span className="text-sm text-muted">К оплате</span>
                <span className="text-[34px] font-bold tracking-[-0.02em]">{money(link.amount, link.currency, { exact: link.amount % 100 !== 0 })}</span>
              </div>
            ) : (
              <Field label="Сумма" error={formError} hint={`От ${money(link.minAmount, link.currency)} до ${money(link.maxAmount, link.currency)}`}>
                <div className="relative">
                  <Input inputMode="decimal" autoFocus placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,\s]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && void go()} className="!h-16 !text-[28px] font-bold pr-10" />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xl text-muted">{CURRENCY_SYMBOL[link.currency]}</span>
                </div>
              </Field>
            )}
          </div>
          {link.amount && formError && <p className="mt-3 text-sm text-bad">{formError}</p>}
          <Button variant="primary" size="lg" className="w-full mt-5" loading={busy} onClick={() => void go()} icon={!busy && <ArrowRight className="size-4" />}>
            Перейти к оплате
          </Button>
          {link.expiresAt && (
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted">
              <CalendarClock className="size-3.5" /> Действует до {longDate(link.expiresAt)}
            </p>
          )}
        </Card>
        <div className="mt-5 flex flex-col items-center gap-3">
          <span className="inline-flex gap-1.5"><CardLogos /><PayLogo name="sbp" /></span>
          <span className="flex items-center gap-2 text-xs text-faint">Работает на <Logo size="sm" /></span>
        </div>
      </div>
    </Center>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-sunken flex items-center justify-center px-4 py-10">{children}</div>;
}

function Unavailable({ title, text, ok }: { title: string; text: string; ok?: boolean }) {
  return (
    <div className="max-w-sm text-center">
      <div className={`mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl ${ok ? 'bg-ok-soft text-ok' : 'bg-surface text-muted'}`}>
        {ok ? <FileText className="size-6" /> : <X className="size-6" />}
      </div>
      <div className="font-semibold text-lg">{title}</div>
      <p className="text-sm text-muted mt-1">{text}</p>
      <div className="mt-6 flex justify-center"><Logo size="sm" /></div>
    </div>
  );
}
