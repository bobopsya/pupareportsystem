import { useQuery } from '@tanstack/react-query';
import { ChevronRight, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AccountPicker } from '../components/AccountPicker';
import { Screen } from '../components/Screen';
import { Button, Card, cx, ErrorNote, Field, Input, Loading, Modal, Segmented, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { money } from '../lib/format';
import { useHome, useRefresh } from '../lib/hooks';
import { SectionTitle } from './Shell';

interface Stock {
  ticker: string;
  name: string;
  sector: string;
  description: string;
  color: string;
  price: number;
  open: number;
  change: number;
  changePct: number;
  halted: boolean;
  driver: string;
  floatShares: number;
  capitalization: number;
  spark?: number[];
  owned?: number;
}

interface Portfolio {
  items: { ticker: string; name: string; color: string; qty: number; price: number; value: number; cost: number; profit: number; profitPct: number; dayChange: number }[];
  value: number;
  cost: number;
  profit: number;
  profitPct: number;
  dayChange: number;
}

const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${money(Math.abs(v), 'RUB', { exact: true })}`;
const tone = (v: number) => (v > 0 ? 'text-ok' : v < 0 ? 'text-bad' : 'text-muted');

export function Ticker({ s, className }: { s: Pick<Stock, 'ticker' | 'color'>; className?: string }) {
  return (
    <span className={cx('flex size-11 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white', className)} style={{ background: s.color }}>
      {s.ticker}
    </span>
  );
}

/** Tiny price line for lists. */
function Spark({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return <span className="w-16" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const k = max - min || 1;
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${(i / (values.length - 1)) * 64},${22 - ((v - min) / k) * 20}`).join(' ');
  return (
    <svg viewBox="0 0 64 24" className="h-6 w-16 shrink-0" aria-hidden="true">
      <path d={d} fill="none" stroke={up ? 'var(--color-ok)' : 'var(--color-bad)'} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** Live price chart: a line with a light fill, a dashed line at the day's open, and a touch/hover readout. */
function PriceChart({ points, open, up }: { points: [number, number][]; open: number; up: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = 220;
  if (points.length < 2) return <div className="flex h-[220px] items-center justify-center text-sm text-muted">Собираем котировки…</div>;
  const prices = points.map((p) => p[1]);
  const min = Math.min(...prices, open);
  const max = Math.max(...prices, open);
  const pad = (max - min) * 0.08 || max * 0.01;
  const lo = min - pad;
  const hi = max + pad;
  const t0 = points[0][0];
  const t1 = points[points.length - 1][0];
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W;
  const y = (p: number) => H - ((p - lo) / (hi - lo)) * H;
  const line = points.map(([t, p], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const color = up ? 'var(--color-ok)' : 'var(--color-bad)';
  const hp = hover !== null ? points[hover] : null;
  const onMove = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const t = t0 + ((clientX - r.left) / r.width) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i][0] - t) < Math.abs(points[best][0] - t)) best = i;
    setHover(best);
  };
  return (
    <div className="relative">
      {hp && (
        <div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-lg bg-fg px-2 py-1 text-xs font-medium text-bg num">
          {money(hp[1], 'RUB', { exact: true })} · {new Date(hp[0]).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      )}
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[220px] w-full touch-none"
        onMouseMove={(e) => onMove(e.clientX)}
        onMouseLeave={() => setHover(null)}
        onTouchMove={(e) => onMove(e.touches[0].clientX)}
        onTouchEnd={() => setHover(null)}
      >
        <path d={`${line} L${W},${H} L0,${H} Z`} fill={color} opacity="0.08" />
        <line x1="0" x2={W} y1={y(open)} y2={y(open)} stroke="var(--color-faint)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hp && <line x1={x(hp[0])} x2={x(hp[0])} y1="0" y2={H} stroke="var(--color-faint)" vectorEffect="non-scaling-stroke" />}
        {hp && <circle cx={x(hp[0])} cy={y(hp[1])} r="4" fill={color} />}
      </svg>
    </div>
  );
}

/** Инвестиции: portfolio and the list of stocks, prices update every few seconds. */
export default function Invest() {
  const nav = useNavigate();
  const { data, error } = useQuery({ queryKey: ['market'], queryFn: () => api<{ stocks: Stock[]; portfolio: Portfolio; feePct: number }>('/market'), refetchInterval: 5000 });
  if (error) return <Screen title="Инвестиции"><ErrorNote>{errorText(error)}</ErrorNote></Screen>;
  if (!data) return <Loading />;
  const p = data.portfolio;
  return (
    <Screen title="Инвестиции">
      <Card>
        <div className="text-sm text-muted">Портфель</div>
        <div className="mt-1 text-[32px] font-semibold leading-none num">{money(p.value, 'RUB', { exact: true })}</div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span className={tone(p.dayChange)}>{signed(p.dayChange)} за день</span>
          <span className={tone(p.profit)}>{signed(p.profit)} ({pct(p.profitPct)}) за всё время</span>
        </div>
        {!p.items.length && <p className="mt-3 text-sm text-muted">Купите первую акцию — от одной штуки. Цена меняется в реальном времени и зависит от сделок клиентов: покупки толкают её вверх, продажи — вниз.</p>}
      </Card>

      {p.items.length > 0 && (
        <>
          <SectionTitle>Мои бумаги</SectionTitle>
          <Card pad={false} className="divide-y divide-line overflow-hidden">
            {p.items.map((i) => (
              <button key={i.ticker} type="button" onClick={() => nav(`/app/invest/${i.ticker}`)} className="flex w-full items-center gap-3 p-4 text-left hover:bg-hover">
                <Ticker s={i} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{i.name}</span>
                  <span className="block text-sm text-muted num">{i.qty.toLocaleString('ru-RU')} шт. · {money(i.price, 'RUB', { exact: true })}</span>
                </span>
                <span className="text-right">
                  <span className="block font-semibold num">{money(i.value, 'RUB', { exact: true })}</span>
                  <span className={cx('block text-sm num', tone(i.profit))}>{pct(i.profitPct)}</span>
                </span>
              </button>
            ))}
          </Card>
        </>
      )}

      <SectionTitle>Акции Асея</SectionTitle>
      <Card pad={false} className="divide-y divide-line overflow-hidden">
        {data.stocks.map((s) => (
          <button key={s.ticker} type="button" onClick={() => nav(`/app/invest/${s.ticker}`)} className="flex w-full items-center gap-3 p-4 text-left hover:bg-hover" data-testid={`stock-${s.ticker}`}>
            <Ticker s={s} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{s.name}</span>
              <span className="block truncate text-sm text-muted">{s.halted ? 'Торги приостановлены' : s.sector}</span>
            </span>
            <Spark values={s.spark ?? []} up={s.change >= 0} />
            <span className="w-[92px] shrink-0 text-right">
              <span className="block font-semibold num">{money(s.price, 'RUB', { exact: true })}</span>
              <span className={cx('block text-sm num', tone(s.change))}>{pct(s.changePct)}</span>
            </span>
            <ChevronRight className="hidden size-4 text-faint sm:block" />
          </button>
        ))}
      </Card>
      <p className="mt-3 text-center text-xs text-faint">Игровая биржа Бобосоюза. Комиссия {data.feePct.toLocaleString('ru-RU')}% от суммы сделки.</p>
    </Screen>
  );
}

interface Detail {
  stock: Stock;
  series: [number, number][];
  day: { low: number; high: number };
  position: { qty: number; cost: number; value: number; profit: number } | null;
  tape: { side: 'buy' | 'sell'; qty: number; price: number; at: number }[];
  feePct: number;
}

const RANGES = [
  { value: '1h', label: '1 ч' },
  { value: '1d', label: 'День' },
  { value: '7d', label: 'Неделя' },
  { value: '30d', label: 'Месяц' },
] as const;

export function StockPage() {
  const { ticker = '' } = useParams();
  const [range, setRange] = useState<(typeof RANGES)[number]['value']>('1h');
  const { data, error, refetch } = useQuery({ queryKey: ['stock', ticker, range], queryFn: () => api<Detail>(`/market/${ticker}?range=${range}`), refetchInterval: range === '1h' ? 3000 : 15000 });
  const [side, setSide] = useState<'buy' | 'sell' | null>(null);
  if (error) return <Screen title={ticker}><ErrorNote>{errorText(error)}</ErrorNote></Screen>;
  if (!data) return <Loading />;
  const s = data.stock;
  const up = s.change >= 0;
  return (
    <Screen title={s.name}>
      <Card>
        <div className="flex items-center gap-3">
          <Ticker s={s} />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-muted">{s.ticker} · {s.sector}</div>
            <div className="text-[30px] font-semibold leading-tight num" data-testid="stock-price">{money(s.price, 'RUB', { exact: true })}</div>
          </div>
          <div className={cx('flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-medium num', up ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad')}>
            {up ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
            {pct(s.changePct)}
          </div>
        </div>
        <div className="mt-4">
          <PriceChart points={data.series} open={s.open} up={up} />
        </div>
        <div className="mt-3">
          <Segmented value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Открытие дня</dt><dd className="text-right num">{money(s.open, 'RUB', { exact: true })}</dd>
          <dt className="text-muted">Мин. / макс. за сутки</dt><dd className="text-right num">{money(data.day.low, 'RUB')} – {money(data.day.high, 'RUB')}</dd>
          <dt className="text-muted">Капитализация</dt><dd className="text-right num">{money(s.capitalization, 'RUB')}</dd>
        </dl>
      </Card>

      {data.position && (
        <Card className="mt-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted">У вас</div>
              <div className="font-semibold num">{data.position.qty.toLocaleString('ru-RU')} шт. · {money(data.position.value, 'RUB', { exact: true })}</div>
            </div>
            <div className={cx('text-right font-semibold num', tone(data.position.profit))}>{signed(data.position.profit)}</div>
          </div>
        </Card>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Button size="lg" variant="primary" disabled={s.halted} onClick={() => setSide('buy')}>Купить</Button>
        <Button size="lg" variant="secondary" disabled={s.halted || !data.position} onClick={() => setSide('sell')}>Продать</Button>
      </div>
      {s.halted && <p className="mt-2 text-center text-sm text-bad">Торги по бумаге приостановлены</p>}

      <SectionTitle>О компании</SectionTitle>
      <Card><p className="text-[15px]">{s.description}</p></Card>

      <SectionTitle>Последние сделки</SectionTitle>
      <Card pad={false} className="divide-y divide-line overflow-hidden">
        {data.tape.length ? (
          data.tape.map((t, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className={t.side === 'buy' ? 'text-ok' : 'text-bad'}>{t.side === 'buy' ? 'Покупка' : 'Продажа'}</span>
              <span className="num">{t.qty.toLocaleString('ru-RU')} × {money(t.price, 'RUB', { exact: true })}</span>
              <span className="text-muted num">{new Date(t.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          ))
        ) : (
          <p className="p-6 text-center text-sm text-muted">Сделок пока не было — станьте первым</p>
        )}
      </Card>
      {side && <TradeSheet stock={s} side={side} owned={data.position?.qty ?? 0} feePct={data.feePct} onClose={() => setSide(null)} onDone={() => void refetch()} />}
    </Screen>
  );
}

function TradeSheet({ stock, side, owned, feePct, onClose, onDone }: { stock: Stock; side: 'buy' | 'sell'; owned: number; feePct: number; onClose: () => void; onDone: () => void }) {
  const { data: home } = useHome();
  const refresh = useRefresh();
  const toast = useToast();
  const accounts = useMemo(() => home?.accounts.filter((a) => a.currency === 'RUB' && ['current', 'business'].includes(a.kind)) ?? [], [home]);
  const [from, setFrom] = useState('');
  const [qty, setQty] = useState('1');
  const [q, setQ] = useState<{ price: number; amount: number; fee: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!from && accounts.length) setFrom(accounts[0].id);
  }, [accounts, from]);
  const n = Math.floor(Number(qty) || 0);
  useEffect(() => {
    setQ(null);
    if (n < 1) return;
    const t = setTimeout(() => void api<typeof q>(`/market/${stock.ticker}/quote`, { body: { side, qty: n } }).then(setQ, () => {}), 200);
    return () => clearTimeout(t);
  }, [n, side, stock.ticker, stock.price]);
  const acc = accounts.find((a) => a.id === from);
  const over = side === 'sell' ? n > owned : !!acc && !!q && q.total > acc.available;
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ total: number; qty: number }>(`/market/${stock.ticker}/trade`, { body: { side, qty: n, accountId: from } });
      refresh();
      onDone();
      toast(`${side === 'buy' ? 'Куплено' : 'Продано'} ${r.qty} шт. ${stock.ticker} на ${money(r.total, 'RUB', { exact: true })}`);
      onClose();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`${side === 'buy' ? 'Купить' : 'Продать'} ${stock.ticker}`}
      footer={<Button size="lg" variant="primary" loading={busy} disabled={n < 1 || !from || over || !q} onClick={() => void submit()}>{q ? `${side === 'buy' ? 'Купить' : 'Продать'} за ${money(q.total, 'RUB', { exact: true })}` : side === 'buy' ? 'Купить' : 'Продать'}</Button>}
    >
      <div className="flex flex-col gap-4">
        <AccountPicker label={side === 'buy' ? 'Списать со счёта' : 'Зачислить на счёт'} accounts={accounts} value={from} onChange={setFrom} />
        <Field label="Количество, шт." error={over ? (side === 'sell' ? `У вас ${owned} шт.` : 'Недостаточно средств') : null} hint={side === 'sell' ? `Доступно ${owned.toLocaleString('ru-RU')} шт.` : undefined}>
          <Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, '').slice(0, 6))} className="text-[22px] font-semibold num" invalid={over} />
        </Field>
        {q && (
          <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
            <dt className="text-muted">Цена исполнения</dt><dd className="text-right num">{money(q.price, 'RUB', { exact: true })}</dd>
            <dt className="text-muted">Сумма</dt><dd className="text-right num">{money(q.amount, 'RUB', { exact: true })}</dd>
            <dt className="text-muted">Комиссия {feePct.toLocaleString('ru-RU')}%</dt><dd className="text-right num">{money(q.fee, 'RUB', { exact: true })}</dd>
          </dl>
        )}
        <p className="text-xs text-muted">Крупная сделка сдвигает цену: при покупке она растёт, при продаже — падает.</p>
        {err && <ErrorNote>{err}</ErrorNote>}
      </div>
    </Modal>
  );
}
