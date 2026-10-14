import { ArrowLeftRight, ChevronRight, Crown, Eye, EyeOff, Gift, Landmark, PiggyBank, Plus, QrCode, Repeat, Smartphone, Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BankCard } from '../components/BankCard';
import { CategoryIcon } from '../components/CategoryIcon';
import { EntryRow } from '../components/EntryRow';
import { RestrictionBanner } from '../components/RestrictionBanner';
import { ActionTile, Row } from '../components/Screen';
import { Card, ErrorNote, Loading, cx } from '../components/ui';
import { errorText } from '../lib/api';
import { bonus, money } from '../lib/format';
import { useHome } from '../lib/hooks';
import { ACCOUNT_KIND_TITLE, type Account } from '../lib/types';
import { SectionTitle } from './Shell';

function readHidden() {
  try {
    return localStorage.getItem('bb-hide') === '1';
  } catch {
    return false;
  }
}

export default function HomePage() {
  const { data, error } = useHome();
  const nav = useNavigate();
  const [hidden, setHidden] = useState(readHidden);
  if (error) return <ErrorNote>{errorText(error)}</ErrorNote>;
  if (!data) return <Loading />;
  const toggle = () => {
    setHidden(!hidden);
    try {
      localStorage.setItem('bb-hide', hidden ? '0' : '1');
    } catch {
      /* private mode */
    }
  };
  const show = (v: number, cur = 'RUB') => (hidden ? '•••• ₽' : money(v, cur, { exact: v % 100 !== 0 }));
  const own = data.accounts.filter((a) => a.kind !== 'loan' && a.kind !== 'credit_card');
  const credit = data.accounts.filter((a) => a.kind === 'credit_card');

  return (
    <div className="bb-fade">
      <RestrictionBanner items={data.restrictions} />

      <div className="mb-1 flex items-center gap-2 text-sm text-muted">
        Все деньги в рублях
        <button type="button" onClick={toggle} aria-label={hidden ? 'Показать балансы' : 'Скрыть балансы'} className="inline-flex size-7 items-center justify-center rounded-full hover:bg-sunken">
          {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      <div className="text-[38px] sm:text-[44px] font-extrabold leading-none tracking-tight num">{show(data.totalRub)}</div>
      <button type="button" onClick={() => nav('/app/bonus')} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-sm font-semibold shadow-card">
        <Gift className="size-4 text-warn" /> {bonus(data.profile.bonus)} Бобобонусов
        {data.profile.tariff === 'prime' && <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-[#f3e6c2] px-2 text-[12px] text-[#7a5a14]"><Crown className="size-3" />Prime</span>}
      </button>

      {/* Cards carousel */}
      <div className="no-scrollbar -mx-4 mt-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
        {data.cards.map((c) => (
          <div key={c.id} className="snap-start">
            <BankCard card={c} onClick={() => nav(`/app/cards/${c.id}`)} />
            <div className="mt-2 px-1 text-sm">
              <span className="font-bold num">{show(data.accounts.find((a) => a.id === c.accountId)?.available ?? 0, c.currency)}</span>
              <span className="text-muted"> · {c.kind === 'credit' ? 'доступно' : c.tariffTitle}</span>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => nav('/app/cards/new')} className="flex aspect-[1.586] w-[200px] shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-[20px] border-2 border-dashed border-line-strong text-muted hover:border-brand hover:text-brand">
          <Plus className="size-7" />
          <span className="text-sm font-semibold">Новая карта</span>
        </button>
      </div>

      {/* Quick actions */}
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 sm:gap-4">
        <ActionTile icon={<Smartphone className="size-6" />} label="По номеру телефона" onClick={() => nav('/app/transfer/phone')} />
        <ActionTile icon={<ArrowLeftRight className="size-6" />} label="Между счетами" onClick={() => nav('/app/transfer/own')} />
        <ActionTile icon={<Repeat className="size-6" />} label="Обмен валют" onClick={() => nav('/app/exchange')} />
        <ActionTile icon={<QrCode className="size-6" />} label="Оплатить по QR" onClick={() => nav('/app/payments#qr')} />
        <ActionTile icon={<Sparkles className="size-6" />} label="Кешбэк" onClick={() => nav('/app/bonus')} />
      </div>

      {/* Credit decisions waiting for the customer */}
      {data.applications.map((a) => (
        <button key={a.id} type="button" onClick={() => nav('/app/credits')} className={cx('mt-5 flex w-full items-center gap-3 rounded-[24px] p-4 text-left', a.status === 'approved' ? 'bg-brand text-on-brand' : 'bg-surface shadow-card')}>
          <Landmark className="size-6 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block font-bold">{a.status === 'approved' ? `Одобрено ${money(a.offerAmount ?? 0)}` : a.status === 'review' ? 'Заявка на проверке' : 'Рассматриваем заявку…'}</span>
            <span className="block text-sm opacity-80">{a.product === 'loan' ? 'Кредит наличными' : 'Кредитная карта'}{a.status === 'approved' ? ' — получите в один клик' : ''}</span>
          </span>
          <ChevronRight className="size-5 shrink-0" />
        </button>
      ))}

      <SectionTitle action={<button type="button" onClick={() => nav('/app/accounts/new')} className="text-sm font-semibold text-brand">Открыть счёт</button>}>Счета</SectionTitle>
      <Card pad={false} className="divide-y divide-line overflow-hidden">
        {[...own, ...credit].map((a) => <AccountRow key={a.id} a={a} show={show} />)}
        {data.loans.map((l) => (
          <Row key={l.id} onClick={() => nav(`/app/loans/${l.id}`)} icon={<CategoryIcon category="credit" />} title="Кредит наличными" sub={l.next ? `Платёж ${money(l.next.amount)} до ${new Date(l.next.dueAt).toLocaleDateString('ru-RU')}` : 'Погашен'} right={<span className={cx('font-bold num', l.status === 'overdue' && 'text-bad')}>{hidden ? '••••' : money(-l.debt)}</span>} />
        ))}
      </Card>

      <SectionTitle action={<button type="button" onClick={() => nav('/app/history')} className="text-sm font-semibold text-brand">Все</button>}>Последние операции</SectionTitle>
      <Card pad={false} className="overflow-hidden">
        {data.recent.length ? data.recent.map((e) => <EntryRow key={e.id} e={e} />) : <div className="px-5 py-8 text-center text-sm text-muted">Здесь появятся ваши покупки и переводы</div>}
      </Card>

      <SectionTitle>Для вас</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Offer onClick={() => nav('/app/savings')} icon={<PiggyBank className="size-6" />} title="Вклад до 18%" text="Проценты каждый день" tone="bg-[#fff4dc] text-[#7a4b00] dark:bg-[#2c2113] dark:text-[#eaa65a]" />
        <Offer onClick={() => nav('/app/credits/apply/credit_card')} icon={<Landmark className="size-6" />} title="Кредитка 120 дней" text="Без процентов на покупки" tone="bg-[#e7efff] text-[#1d3f8f] dark:bg-[#151d33] dark:text-[#82a8ff]" />
        <Offer onClick={() => nav('/app/profile#prime')} icon={<Crown className="size-6" />} title="Bobo Prime" text="Кешбэк до 7% и переводы без комиссии" tone="bg-[#f3e6c2] text-[#5c4410] dark:bg-[#2b2412] dark:text-[#e6c56b]" />
      </div>
    </div>
  );
}

function AccountRow({ a, show }: { a: Account; show: (v: number, cur?: string) => string }) {
  const nav = useNavigate();
  const cat = a.kind === 'savings' || a.kind === 'deposit' ? 'savings' : a.kind === 'credit_card' ? 'credit' : a.kind === 'business' ? 'services' : 'card';
  const sub = a.kind === 'deposit' || a.kind === 'savings' ? `${String(a.params.rate ?? '')}% годовых` : a.kind === 'credit_card' ? `Лимит ${money(a.creditLimit)}` : `${ACCOUNT_KIND_TITLE[a.kind]} •• ${a.number.slice(-4)}`;
  return <Row onClick={() => nav(`/app/accounts/${a.id}`)} icon={<CategoryIcon category={cat} />} title={a.name} sub={sub} right={<span className="font-bold num">{show(a.kind === 'credit_card' ? a.available : a.balance, a.currency)}</span>} />;
}

function Offer({ icon, title, text, tone, onClick }: { icon: ReactNode; title: string; text: string; tone: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cx('flex min-h-[132px] flex-col justify-between rounded-[24px] p-4 text-left transition-transform active:scale-[0.98]', tone)}>
      {icon}
      <span>
        <span className="block text-[17px] font-extrabold leading-tight">{title}</span>
        <span className="block text-sm opacity-80">{text}</span>
      </span>
    </button>
  );
}
