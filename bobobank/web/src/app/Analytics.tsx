import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { CATEGORY_STYLE, CategoryIcon } from '../components/CategoryIcon';
import { Donut, MonthBars } from '../components/charts';
import { Screen } from '../components/Screen';
import { Card, ErrorNote, Loading } from '../components/ui';
import { api, errorText } from '../lib/api';
import { bonus, compact, money, monthTitle } from '../lib/format';
import { SectionTitle } from './Shell';

interface A {
  month: string;
  spent: number;
  transfers: number;
  income: number;
  bonus: number;
  categories: { category: string; title: string; total: number; n: number }[];
  months: { month: string; total: number }[];
}

const shift = (ym: string, d: number) => {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + d, 1));
  return t.toISOString().slice(0, 7);
};

export default function Analytics() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { data, error } = useQuery({ queryKey: ['analytics', month], queryFn: () => api<A>(`/analytics?month=${month}`) });
  const current = month >= new Date().toISOString().slice(0, 7);
  return (
    <Screen title="Расходы" back={null}>
      <div className="mb-4 flex items-center justify-between">
        <button type="button" aria-label="Предыдущий месяц" onClick={() => setMonth(shift(month, -1))} className="inline-flex size-10 items-center justify-center rounded-full hover:bg-sunken"><ChevronLeft className="size-5" /></button>
        <div className="text-lg font-extrabold">{monthTitle(month)}</div>
        <button type="button" aria-label="Следующий месяц" disabled={current} onClick={() => setMonth(shift(month, 1))} className="inline-flex size-10 items-center justify-center rounded-full hover:bg-sunken disabled:opacity-30"><ChevronRight className="size-5" /></button>
      </div>
      {error && <ErrorNote>{errorText(error)}</ErrorNote>}
      {!data ? (
        <Loading />
      ) : (
        <>
          <Card>
            <Donut
              total={data.spent}
              items={data.categories.map((c) => ({ id: c.category, value: c.total, color: CATEGORY_STYLE[c.category]?.color ?? '#94a3b8', label: c.title }))}
              center={(h) => (
                <>
                  <span className="text-xs text-muted">{h === null ? 'Траты' : data.categories[h].title}</span>
                  <span className="text-[22px] font-extrabold num">{money(h === null ? data.spent : data.categories[h].total)}</span>
                </>
              )}
            />
            <div className="mt-5 grid grid-cols-3 gap-2 text-center">
              <Stat label="Пополнения" value={money(data.income)} tone="text-ok" />
              <Stat label="Переводы" value={money(data.transfers)} />
              <Stat label="Кешбэк" value={`${bonus(data.bonus)} Б`} tone="text-warn" />
            </div>
          </Card>
          <SectionTitle>По категориям</SectionTitle>
          <Card pad={false} className="overflow-hidden">
            {data.categories.length ? (
              data.categories.map((c) => (
                <div key={c.category} className="flex items-center gap-3 px-4 py-3">
                  <CategoryIcon category={c.category} />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2">
                      <span className="truncate font-semibold">{c.title}</span>
                      <span className="font-bold num">{money(c.total)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken">
                      <div className="h-full rounded-full" style={{ width: `${(c.total / data.spent) * 100}%`, background: CATEGORY_STYLE[c.category]?.color }} />
                    </div>
                    <div className="mt-1 text-xs text-muted">{c.n} операц. · {Math.round((c.total / data.spent) * 100)}%</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-5 py-8 text-center text-sm text-muted">В этом месяце трат не было</div>
            )}
          </Card>
          <SectionTitle>Полгода</SectionTitle>
          <Card>
            <MonthBars data={data.months.map((m) => ({ key: m.month, label: monthTitle(m.month).slice(0, 3), value: m.total }))} format={compact} active={month} onPick={setMonth} />
          </Card>
        </>
      )}
    </Screen>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl bg-sunken px-2 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-0.5 truncate font-bold num ${tone ?? ''}`}>{value}</div>
    </div>
  );
}
