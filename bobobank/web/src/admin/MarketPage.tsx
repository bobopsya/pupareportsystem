import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, cx, ErrorNote, Field, Input, Loading, PageHeader, Toggle, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { money } from '../lib/format';

interface Row {
  ticker: string;
  name: string;
  sector: string;
  color: string;
  price: number;
  changePct: number;
  halted: boolean;
  driver: string;
  vol: number;
  drift: number;
  fair: number;
  shopId: number | null;
  holders: number;
}

const DRIVER: Record<string, string> = { none: 'Справедливая цена задаётся вручную', bank: 'Следит за деньгами клиентов', gpay: 'Следит за оборотом GPAY', shop: 'Следит за оборотом магазина' };

/** Admin: the stock market — halt trading, volatility, fair value, IPO of GPAY shops. */
export function MarketPage() {
  const toast = useToast();
  const { data, refetch } = useQuery({ queryKey: ['admin', 'market'], queryFn: () => api<{ stocks: Row[] }>('/admin/market'), refetchInterval: 5000 });
  const [ipo, setIpo] = useState({ ticker: '', name: '', price: '100', floatShares: '100000', shopId: '' });
  const [err, setErr] = useState<string | null>(null);
  if (!data) return <Loading />;
  const update = async (t: string, body: object) => {
    try {
      await api(`/admin/market/${t}`, { body });
      await refetch();
      toast('Сохранено');
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  };
  const list = async () => {
    setErr(null);
    try {
      await api('/admin/market', { body: { ticker: ipo.ticker, name: ipo.name, price: Math.round(Number(ipo.price) * 100), floatShares: Number(ipo.floatShares), shopId: ipo.shopId ? Number(ipo.shopId) : undefined } });
      setIpo({ ticker: '', name: '', price: '100', floatShares: '100000', shopId: '' });
      await refetch();
      toast('Бумага размещена');
    } catch (e) {
      setErr(errorText(e));
    }
  };
  return (
    <>
      <PageHeader title="Биржа" sub="Цены меняются каждые 5 секунд и зависят от сделок клиентов" />
      <Card pad={false} className="divide-y divide-line overflow-hidden">
        {data.stocks.map((s) => (
          <div key={s.ticker} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: s.color }}>{s.ticker}</span>
              <div className="min-w-0">
                <div className="font-medium">{s.name} <span className="text-muted">· {s.holders} держателей</span></div>
                <div className="text-sm text-muted">{DRIVER[s.driver]}{s.shopId ? ` (магазин ${s.shopId})` : ''}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold num">{money(s.price, 'RUB', { exact: true })}</div>
              <div className={cx('text-sm num', s.changePct >= 0 ? 'text-ok' : 'text-bad')}>{s.changePct.toFixed(2)}%</div>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                Волатильность
                <Input className="!h-9 w-20" defaultValue={String(Math.round(s.vol * 100))} onBlur={(e) => Number(e.target.value) !== Math.round(s.vol * 100) && void update(s.ticker, { vol: Number(e.target.value) / 100 })} />%
              </label>
              <Toggle checked={!s.halted} onChange={(on) => void update(s.ticker, { halted: !on })} />
            </div>
          </div>
        ))}
      </Card>
      <Card className="mt-4 flex flex-col gap-3">
        <div className="font-semibold">Разместить новую бумагу (IPO)</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Тикер" hint="3–5 латинских букв"><Input value={ipo.ticker} onChange={(e) => setIpo({ ...ipo, ticker: e.target.value.toUpperCase() })} /></Field>
          <Field label="Название"><Input value={ipo.name} onChange={(e) => setIpo({ ...ipo, name: e.target.value })} /></Field>
          <Field label="Стартовая цена, ₽"><Input inputMode="decimal" value={ipo.price} onChange={(e) => setIpo({ ...ipo, price: e.target.value })} /></Field>
          <Field label="Акций в обращении"><Input inputMode="numeric" value={ipo.floatShares} onChange={(e) => setIpo({ ...ipo, floatShares: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Магазин GPAY (номер)" hint="Если указан — цена следит за оборотом магазина"><Input inputMode="numeric" value={ipo.shopId} onChange={(e) => setIpo({ ...ipo, shopId: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
        {err && <ErrorNote>{err}</ErrorNote>}
        <Button variant="primary" onClick={() => void list()} disabled={!ipo.ticker || !ipo.name}>Разместить</Button>
      </Card>
    </>
  );
}
