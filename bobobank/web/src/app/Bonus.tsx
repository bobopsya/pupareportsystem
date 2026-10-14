import { useQuery } from '@tanstack/react-query';
import { Check, Crown, Gift } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CategoryIcon } from '../components/CategoryIcon';
import { Screen } from '../components/Screen';
import { Button, Card, ErrorNote, Field, Input, Loading, Modal, cx, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { bonus, dateTime, money, toAmount } from '../lib/format';
import { useRefresh } from '../lib/hooks';
import { SectionTitle } from './Shell';

interface B {
  balance: number;
  tariff: 'standard' | 'prime';
  base: number;
  raised: number;
  cap: number;
  accruedThisMonth: number;
  chosen: string[];
  pick: number;
  categories: { id: string; title: string }[];
  log: { id: number; amount: number; title: string; category: string | null; createdAt: number }[];
}

export default function Bonus() {
  const nav = useNavigate();
  const toast = useToast();
  const refresh = useRefresh();
  const { data, error, refetch } = useQuery({ queryKey: ['bonus'], queryFn: () => api<B>('/bonus') });
  const [picked, setPicked] = useState<string[]>([]);
  const [redeem, setRedeem] = useState(false);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorNote>{errorText(error)}</ErrorNote>;
  if (!data) return <Loading />;
  const choosing = data.chosen.length === 0;
  const save = async () => {
    setBusy(true);
    try {
      await api('/bonus/categories', { body: { categories: picked } });
      toast('Категории выбраны до конца месяца');
      await refetch();
    } catch (e) {
      toast(errorText(e), 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title="Бобобонусы">
      <Card className="relative overflow-hidden bg-gradient-to-br from-[#ffcf5c] via-[#f6a723] to-[#e57e12] !text-[#3d2300]">
        <Gift className="absolute -right-4 -bottom-6 size-36 opacity-15" />
        <div className="text-sm font-semibold opacity-80">Баланс</div>
        <div className="text-[40px] font-extrabold leading-tight num">{bonus(data.balance)}</div>
        <div className="text-sm font-medium opacity-80">1 бонус = 1 ₽ · за месяц начислено {bonus(data.accruedThisMonth)} из {bonus(data.cap)}</div>
        <Button className="mt-4 !bg-white/90 !text-[#3d2300] hover:!bg-white" disabled={data.balance < 10_000} onClick={() => setRedeem(true)}>Обменять на рубли</Button>
      </Card>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Card className="!p-4"><div className="text-xs text-muted">На все покупки</div><div className="text-2xl font-extrabold">{data.base}%</div></Card>
        <Card className="!p-4"><div className="text-xs text-muted">В выбранных категориях</div><div className="text-2xl font-extrabold text-brand">{data.raised}%</div></Card>
      </div>
      {data.tariff !== 'prime' && (
        <button type="button" onClick={() => nav('/app/profile#prime')} className="mt-3 flex w-full items-center gap-3 rounded-[24px] bg-[#f3e6c2] p-4 text-left text-[#5c4410] dark:bg-[#2b2412] dark:text-[#e6c56b]">
          <Crown className="size-6 shrink-0" />
          <span className="text-sm"><b>С Bobo Prime</b> — 1,5% на всё и 7% в любимых категориях</span>
        </button>
      )}

      <SectionTitle>{choosing ? `Выберите ${data.pick} категории на месяц` : 'Повышенный кешбэк в этом месяце'}</SectionTitle>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {(choosing ? data.categories : data.categories.filter((c) => data.chosen.includes(c.id))).map((c) => {
          const on = choosing ? picked.includes(c.id) : true;
          return (
            <button
              key={c.id}
              type="button"
              disabled={!choosing}
              onClick={() => setPicked(on ? picked.filter((x) => x !== c.id) : picked.length < data.pick ? [...picked, c.id] : picked)}
              className={cx('relative flex items-center gap-2.5 rounded-[20px] border-2 bg-surface p-3 text-left text-sm font-semibold shadow-card transition-colors', on ? 'border-brand' : 'border-transparent')}
            >
              <CategoryIcon category={c.id} size="sm" />
              <span className="min-w-0 leading-tight">{c.title}</span>
              {on && <Check className="absolute right-2 top-2 size-4 text-brand" strokeWidth={3} />}
            </button>
          );
        })}
      </div>
      {choosing && <Button className="mt-3 w-full" size="lg" variant="primary" loading={busy} disabled={picked.length !== data.pick} onClick={() => void save()}>Сохранить ({picked.length} из {data.pick})</Button>}

      <SectionTitle>Начисления и списания</SectionTitle>
      <Card pad={false} className="overflow-hidden">
        {data.log.length ? data.log.map((l) => (
          <div key={l.id} className="flex items-center gap-3 px-4 py-3">
            <CategoryIcon category={l.category ?? 'bonus'} size="sm" />
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{l.title}</div><div className="text-xs text-muted">{dateTime(l.createdAt)}</div></div>
            <div className={cx('font-bold num', l.amount > 0 ? 'text-warn' : 'text-muted')}>{l.amount > 0 ? '+' : '−'}{bonus(Math.abs(l.amount))}</div>
          </div>
        )) : <div className="px-5 py-8 text-center text-sm text-muted">Платите картой Bobobank — бонусы появятся здесь</div>}
      </Card>
      <RedeemModal open={redeem} max={data.balance} onClose={() => setRedeem(false)} onDone={() => { void refetch(); refresh(); }} />
    </Screen>
  );
}

function RedeemModal({ open, max, onClose, onDone }: { open: boolean; max: number; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal open={open} onClose={onClose} title="Обмен бонусов" size="sm" footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" loading={busy} onClick={() => {
      const a = toAmount(v);
      if (!a) return setErr('Введите количество бонусов');
      setBusy(true);
      api('/bonus/redeem', { body: { amount: a } }).then(() => { toast(`${money(Math.round(Number(a) * 100))} зачислены на счёт`); onDone(); onClose(); }, (e) => setErr(errorText(e))).finally(() => setBusy(false));
    }}>Обменять</Button></>}>
      <Field label="Сколько бонусов" hint={`Доступно ${bonus(max)}, от 100`} error={err}>
        <Input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} placeholder={String(Math.floor(max / 100))} />
      </Field>
    </Modal>
  );
}
