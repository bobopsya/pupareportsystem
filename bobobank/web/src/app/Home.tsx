import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, ChevronRight, Crown, Eye, EyeOff, Gift, Landmark, PiggyBank, Plus, QrCode, Repeat, Search, Store, Wallet } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { MiniCard } from '../components/BankCard';
import { CATEGORY_STYLE, CategoryIcon } from '../components/CategoryIcon';
import { EntryRow } from '../components/EntryRow';
import { Favorites } from '../components/Favorites';
import { RestrictionBanner } from '../components/RestrictionBanner';
import { ActionTile } from '../components/Screen';
import { ErrorNote, Loading, cx } from '../components/ui';
import { api, errorText } from '../lib/api';
import { bonus, money } from '../lib/format';
import { useHome } from '../lib/hooks';
import { ACCOUNT_KIND_TITLE, type Account } from '../lib/types';

function readHidden() {
  try {
    return localStorage.getItem('bb-hide') === '1';
  } catch {
    return false;
  }
}

const MONTH_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];

interface Spend {
  month: string;
  spent: number;
  categories: { category: string; title: string; total: number }[];
}

export default function HomePage() {
  const { data, error } = useHome();
  const nav = useNavigate();
  const [hidden, setHidden] = useState(readHidden);
  const { data: spend } = useQuery({ queryKey: ['analytics', 'home'], queryFn: () => api<Spend>('/analytics') });
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
  const show = (v: number, cur = 'RUB') => (hidden ? '•••' : money(v, cur, { exact: v % 100 !== 0 }));
  const cardAccounts = new Set(data.cards.map((c) => c.accountId));
  const accounts = data.accounts.filter((a) => ['current', 'business', 'kids'].includes(a.kind) && !cardAccounts.has(a.id));
  const savings = data.accounts.filter((a) => a.kind === 'savings' || a.kind === 'deposit');

  return (
    <div className="bb-fade flex flex-col gap-3">
      <button type="button" onClick={() => nav('/app/history?focus=1')} className="flex h-11 items-center gap-2 rounded-xl bg-surface px-3.5 text-[15px] text-faint">
        <Search className="size-[18px]" /> Поиск по операциям
      </button>

      {/* Stories */}
      <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 py-1 sm:-mx-6 sm:px-6">
        <Story color="#FFB800" icon={<Gift className="size-6" />} label="Кешбэк" onClick={() => nav('/app/bonus')} />
        <Story color="#21A038" icon={<PiggyBank className="size-6" />} label="Вклад 18%" onClick={() => nav('/app/savings')} />
        <Story color="#1E6FD9" icon={<Landmark className="size-6" />} label="Кредитка" onClick={() => nav('/app/credits/apply/credit_card')} />
        <Story color="#2B2A28" icon={<Crown className="size-6 text-[#E7C987]" />} label="Prime" onClick={() => nav('/app/profile#prime')} />
        <Story color="#111111" icon={<Store className="size-6" />} label="GPAY" onClick={() => nav('/app/accounts/new')} />
      </div>

      <RestrictionBanner items={data.restrictions} />

      {data.applications.map((a) => (
        <button key={a.id} type="button" onClick={() => nav('/app/credits')} className={cx('flex w-full items-center gap-3 rounded-2xl p-4 text-left', a.status === 'approved' ? 'bg-brand text-on-brand' : 'bg-surface')}>
          <Landmark className="size-6 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{a.status === 'approved' ? `Одобрено ${money(a.offerAmount ?? 0)}` : a.status === 'review' ? 'Заявка на проверке' : 'Рассматриваем заявку…'}</span>
            <span className="block text-sm opacity-80">{a.product === 'loan' ? 'Кредит наличными' : 'Кредитная карта'}{a.status === 'approved' ? ' — получите в один клик' : ''}</span>
          </span>
          <ChevronRight className="size-5 shrink-0" />
        </button>
      ))}

      {/* Wallet */}
      <section className="rounded-2xl bg-surface">
        <div className="flex items-start justify-between px-4 pt-4">
          <div>
            <div className="text-[13px] text-muted">Кошелёк</div>
            <div className="text-[28px] font-semibold leading-tight tracking-tight num">{show(data.totalRub)}</div>
          </div>
          <button type="button" onClick={toggle} aria-label={hidden ? 'Показать балансы' : 'Скрыть балансы'} className="inline-flex size-9 items-center justify-center rounded-full text-muted hover:bg-sunken">
            {hidden ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        </div>
        <Group title="Карты">
          {data.cards.map((c) => {
            const acc = data.accounts.find((a) => a.id === c.accountId);
            return (
              <WalletRow
                key={c.id}
                icon={<MiniCard card={c} />}
                title={c.kind === 'credit' ? 'Кредитная карта' : c.tariff === 'kids' ? `Детская · ${c.holder.split(' ')[0]}` : `${c.networkTitle} ${c.form === 'virtual' ? 'цифровая' : ''}`.trim()}
                sub={`•• ${c.last4}`}
                value={show(acc?.available ?? 0, c.currency)}
                onClick={() => nav(`/app/cards/${c.id}`)}
              />
            );
          })}
          <WalletRow icon={<span className="flex h-7 w-11 items-center justify-center rounded-[5px] border border-dashed border-line-strong text-muted"><Plus className="size-4" /></span>} title="Новая карта" muted onClick={() => nav('/app/cards/new')} />
        </Group>
        {accounts.length > 0 && (
          <Group title="Счета">
            {accounts.map((a) => <AccountLine key={a.id} a={a} show={show} />)}
          </Group>
        )}
        {savings.length > 0 && (
          <Group title="Вклады и накопления">
            {savings.map((a) => <AccountLine key={a.id} a={a} show={show} />)}
          </Group>
        )}
        {(data.loans.length > 0 || data.accounts.some((a) => a.kind === 'credit_card')) && (
          <Group title="Кредиты">
            {data.loans.map((l) => (
              <WalletRow key={l.id} icon={<RoundIcon category="credit" />} title="Кредит наличными" sub={l.next ? `Платёж ${money(l.next.amount)} · ${new Date(l.next.dueAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}` : 'Погашен'} value={hidden ? '•••' : money(l.debt)} danger={l.status === 'overdue'} onClick={() => nav(`/app/loans/${l.id}`)} />
            ))}
          </Group>
        )}
        <button type="button" onClick={() => nav('/app/accounts/new')} className="flex w-full items-center justify-between border-t border-line px-4 py-3 text-[15px] font-medium text-brand">
          Все продукты <ChevronRight className="size-4" />
        </button>
      </section>

      {/* Quick actions */}
      <section className="rounded-2xl bg-surface px-2 py-4">
        <div className="grid grid-cols-4 gap-1">
          <ActionTile icon={<ArrowLeftRight className="size-5" />} label="Перевести" onClick={() => nav('/app/payments')} />
          <ActionTile icon={<Wallet className="size-5" />} label="Пополнить" onClick={() => nav('/app/transfer/own')} />
          <ActionTile icon={<QrCode className="size-5" />} label="Оплатить по QR" onClick={() => nav('/app/payments#qr')} />
          <ActionTile icon={<Repeat className="size-5" />} label="Обмен валют" onClick={() => nav('/app/exchange')} />
        </div>
      </section>

      <Favorites />

      {/* Spending this month */}
      {spend && (
        <button type="button" onClick={() => nav('/app/analytics')} className="rounded-2xl bg-surface p-4 text-left">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-medium">Расходы в {MONTH_IN[Number(spend.month.slice(5, 7)) - 1]}</span>
            <ChevronRight className="size-4 text-faint" />
          </div>
          <div className="mt-1 text-[22px] font-semibold num">{hidden ? '•••' : money(spend.spent)}</div>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-sunken">
            {spend.categories.map((c) => <span key={c.category} style={{ width: `${(c.total / Math.max(spend.spent, 1)) * 100}%`, background: CATEGORY_STYLE[c.category]?.color ?? '#a5a7ad' }} />)}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-muted">
            {spend.categories.slice(0, 3).map((c) => (
              <span key={c.category} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: CATEGORY_STYLE[c.category]?.color }} />{c.title}</span>
            ))}
            {!spend.categories.length && <span>Покупок в этом месяце ещё не было</span>}
          </div>
        </button>
      )}

      <section className="rounded-2xl bg-surface">
        <div className="flex items-center justify-between px-4 pt-4 pb-1">
          <span className="text-[15px] font-medium">Последние операции</span>
          <button type="button" onClick={() => nav('/app/history')} className="text-sm font-medium text-brand">Все</button>
        </div>
        {data.recent.length ? data.recent.slice(0, 5).map((e) => <EntryRow key={e.id} e={e} />) : <div className="px-4 pb-6 pt-3 text-sm text-muted">Здесь появятся ваши покупки и переводы</div>}
      </section>

      <div className="px-1 pt-1 text-center text-[13px] text-muted">
        <button type="button" onClick={() => nav('/app/bonus')} className="inline-flex items-center gap-1.5"><Gift className="size-4 text-[#FFB800]" />{bonus(data.profile.bonus)} Бобобонусов</button>
      </div>
    </div>
  );
}

function Story({ color, icon, label, onClick }: { color: string; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-[72px] shrink-0 flex-col items-center gap-1.5">
      <span className="rounded-full p-[2px] ring-2 ring-brand">
        <span className="flex size-[58px] items-center justify-center rounded-full text-white" style={{ background: color }}>{icon}</span>
      </span>
      <span className="text-[12px] leading-tight">{label}</span>
    </button>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pt-3">
      <div className="px-4 pb-1 text-[13px] text-muted">{title}</div>
      {children}
    </div>
  );
}

function RoundIcon({ category }: { category: string }) {
  return <CategoryIcon category={category} size="sm" className="!size-9" />;
}

function WalletRow({ icon, title, sub, value, onClick, muted, danger }: { icon: ReactNode; title: string; sub?: string; value?: string; onClick: () => void; muted?: boolean; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-sunken/60">
      <span className="flex w-11 shrink-0 justify-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate text-[15px]', muted && 'text-muted')}>{title}</span>
        {sub && <span className="block truncate text-[13px] text-muted">{sub}</span>}
      </span>
      {value && <span className={cx('shrink-0 text-[15px] font-medium num', danger && 'text-bad')}>{value}</span>}
    </button>
  );
}

function AccountLine({ a, show }: { a: Account; show: (v: number, cur?: string) => string }) {
  const nav = useNavigate();
  const cat = a.kind === 'savings' || a.kind === 'deposit' ? 'savings' : a.kind === 'business' ? 'services' : 'card';
  const sub = a.kind === 'deposit' || a.kind === 'savings' ? `${String(a.params.rate ?? '')}% годовых` : `${ACCOUNT_KIND_TITLE[a.kind]} •• ${a.number.slice(-4)}`;
  return <WalletRow icon={<RoundIcon category={cat} />} title={a.name} sub={sub} value={show(a.balance, a.currency)} onClick={() => nav(`/app/accounts/${a.id}`)} />;
}
