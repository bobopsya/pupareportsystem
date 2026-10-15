import { Baby, Check, Crown, CreditCard, Landmark, Smartphone } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BankCard, DESIGN_BG } from '../components/BankCard';
import { NetworkLogo } from '../components/PaymentLogos';
import { Screen } from '../components/Screen';
import { Button, Card, ErrorNote, Field, Input, Loading, Select, cx } from '../components/ui';
import { api, errorText } from '../lib/api';
import { useHome, useRefresh } from '../lib/hooks';
import type { Card as CardT, Network } from '../lib/types';

type Product = 'virtual' | 'plastic' | 'kids' | 'prime';
const NETWORKS: { id: Network; title: string; note: string }[] = [
  { id: 'mir', title: 'МИР', note: 'Национальная платёжная система' },
  { id: 'visa', title: 'Visa', note: 'Международная' },
  { id: 'mastercard', title: 'Mastercard', note: 'Международная' },
  { id: 'unionpay', title: 'UnionPay', note: 'Платёжная система Китая' },
];
const DESIGNS: Record<Product, string[]> = {
  virtual: ['green', 'black', 'white', 'silver'],
  plastic: ['green', 'black', 'white', 'silver'],
  kids: ['kids', 'green', 'white'],
  prime: ['prime', 'black'],
};

export default function IssueCard() {
  const nav = useNavigate();
  const refresh = useRefresh();
  const { data } = useHome();
  const [product, setProduct] = useState<Product | null>(null);
  const [network, setNetwork] = useState<Network>('mir');
  const [design, setDesign] = useState('green');
  const [accountId, setAccountId] = useState('');
  const [child, setChild] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<CardT | null>(null);
  if (!data) return <Loading />;
  const prime = data.profile.tariff === 'prime';
  const accounts = data.accounts.filter((a) => a.kind === 'current' || a.kind === 'business');

  if (issued) {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center text-center bb-fade">
        <div className="bb-card-in"><BankCard card={issued} size="lg" /></div>
        <div className="mt-6 inline-flex size-12 items-center justify-center rounded-full bg-brand text-on-brand bb-pop"><Check className="size-6" strokeWidth={3} /></div>
        <h1 className="mt-4 text-2xl font-semibold">Карта выпущена</h1>
        <p className="mt-1 max-w-sm text-muted">{issued.form === 'virtual' ? 'Ей уже можно платить в интернете и через GPAY.' : 'Пластик привезём за 3 дня, а пока платите цифровой картой.'}</p>
        <div className="mt-6 flex w-full max-w-sm flex-col gap-2">
          <Button size="lg" variant="primary" onClick={() => nav(`/app/cards/${issued.id}`, { replace: true })}>Открыть карту</Button>
          <Button size="lg" onClick={() => nav('/app', { replace: true })}>На главную</Button>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <Screen title="Новая карта">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Choice icon={<Smartphone className="size-6" />} title="Виртуальная" text="Бесплатно, выпуск за секунду. Для покупок в интернете и через GPAY." onClick={() => (setProduct('virtual'), setDesign('green'))} />
          <Choice icon={<CreditCard className="size-6" />} title="Пластиковая" text="Бесконтактная карта с доставкой, кешбэк до 3%." onClick={() => (setProduct('plastic'), setDesign('black'))} />
          <Choice icon={<Baby className="size-6" />} title="Детская" text="Отдельный счёт, лимит трат и уведомления родителю." onClick={() => (setProduct('kids'), setDesign('kids'))} />
          <Choice icon={<Crown className="size-6" />} title="Bobo Prime" text={prime ? 'Металлический дизайн, кешбэк до 7%.' : 'Нужна подписка Bobo Prime.'} disabled={!prime} onClick={() => (setProduct('prime'), setDesign('prime'))} />
          <Choice icon={<Landmark className="size-6" />} title="Кредитная" text="120 дней без процентов, решение за минуту." onClick={() => nav('/app/credits/apply/credit_card')} />
        </div>
      </Screen>
    );
  }

  const preview = { design, network, last4: '0000', exp: '••/••', holder: product === 'kids' ? child || 'ИМЯ РЕБЁНКА' : data.profile.name, form: product === 'plastic' || product === 'prime' ? 'plastic' : 'virtual', status: 'active', kind: 'debit', tariff: product === 'kids' ? 'kids' : product === 'prime' ? 'prime' : 'standard' } as const;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ card: CardT }>('/cards', {
        body: { network, design, form: preview.form, tariff: preview.tariff, accountId: accountId || undefined, childName: product === 'kids' ? child : undefined },
      });
      refresh();
      setIssued(r.card);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={{ virtual: 'Виртуальная карта', plastic: 'Пластиковая карта', kids: 'Детская карта', prime: 'Карта Bobo Prime' }[product]} back={null} actions={<Button size="sm" variant="ghost" onClick={() => setProduct(null)}>Назад</Button>}>
      <div className="flex justify-center"><BankCard card={{ ...preview, holder: preview.holder.toUpperCase() }} size="lg" /></div>

      <h2 className="mt-7 mb-3 font-semibold">Платёжная система</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {NETWORKS.map((n) => (
          <button key={n.id} type="button" onClick={() => setNetwork(n.id)} className={cx('flex flex-col items-start gap-2 rounded-[20px] border-2 bg-surface p-3 text-left transition-colors', network === n.id ? 'border-brand' : 'border-transparent shadow-card')}>
            <NetworkLogo network={n.id} className="h-7 w-11 border border-line" />
            <span><span className="block text-sm font-semibold">{n.title}</span><span className="block text-xs text-muted leading-snug">{n.note}</span></span>
          </button>
        ))}
      </div>

      <h2 className="mt-7 mb-3 font-semibold">Дизайн</h2>
      <div className="flex flex-wrap gap-3">
        {DESIGNS[product].map((d) => (
          <button key={d} type="button" aria-label={d} onClick={() => setDesign(d)} className={cx('h-12 w-[76px] rounded-lg border border-line ring-offset-2 ring-offset-bg transition', design === d ? 'ring-2 ring-brand' : 'ring-0')} style={{ background: DESIGN_BG[d] }} />
        ))}
      </div>

      <Card className="mt-7 flex flex-col gap-4">
        {product === 'kids' ? (
          <Field label="Имя и фамилия ребёнка" hint="Мы откроем отдельный детский счёт. Лимит — 15 000 ₽ в месяц, его можно поменять.">
            <Input value={child} onChange={(e) => setChild(e.target.value)} placeholder="Маша Петрова" />
          </Field>
        ) : (
          <Field label="Счёт карты">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Основной рублёвый счёт</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} •• {a.number.slice(-4)} ({a.currency})</option>)}
            </Select>
          </Field>
        )}
        <ul className="text-sm text-muted space-y-1">
          <li>• Обслуживание — бесплатно{product === 'prime' ? ' (входит в подписку Prime)' : ''}</li>
          <li>• Кешбэк Бобобонусами за каждую покупку</li>
          <li>• Покупки в интернете подтверждаются в приложении</li>
        </ul>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button size="lg" variant="primary" loading={busy} disabled={product === 'kids' && child.trim().length < 3} onClick={() => void submit()}>Выпустить карту</Button>
      </Card>
    </Screen>
  );
}

function Choice({ icon, title, text, onClick, disabled }: { icon: ReactNode; title: string; text: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="flex items-start gap-3 rounded-2xl bg-surface p-4 text-left shadow-card transition-transform active:scale-[0.99] disabled:opacity-50">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand">{icon}</span>
      <span><span className="block text-[17px] font-semibold">{title}</span><span className="block text-sm text-muted">{text}</span></span>
    </button>
  );
}
