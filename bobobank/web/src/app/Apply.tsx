import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BankCard, DESIGN_BG } from '../components/BankCard';
import { NetworkLogo } from '../components/PaymentLogos';
import { Screen } from '../components/Screen';
import { Button, Card, ErrorNote, Loading, cx } from '../components/ui';
import { api, errorText } from '../lib/api';
import { money } from '../lib/format';
import { useHome } from '../lib/hooks';
import type { Network } from '../lib/types';

interface P {
  products: { loanRate: number; loanMin: number; loanMax: number; creditCardRate: number; creditCardMax: number; creditCardGraceDays: number };
}

function annuity(p: number, rate: number, n: number) {
  const r = rate / 100 / 12;
  return Math.ceil((p * r) / (1 - (1 + r) ** -n));
}

export default function Apply() {
  const { product = 'loan' } = useParams() as { product: 'loan' | 'credit_card' };
  const nav = useNavigate();
  const { data: home } = useHome();
  const { data } = useQuery({ queryKey: ['products'], queryFn: () => api<P>('/products') });
  const [amount, setAmount] = useState(product === 'loan' ? 30_000_000 : 10_000_000);
  const [term, setTerm] = useState(24);
  const [network, setNetwork] = useState<Network>('mir');
  const [design, setDesign] = useState('black');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data || !home) return <Loading />;
  const p = data.products;
  const loan = product === 'loan';
  const min = loan ? p.loanMin : 1_000_000;
  const max = loan ? p.loanMax : p.creditCardMax;
  const step = loan ? 1_000_000 : 500_000;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/applications', { body: { product, amount: (amount / 100).toFixed(2), term: loan ? term : 0, network: loan ? undefined : network, design: loan ? undefined : design } });
      nav('/app/credits', { replace: true });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title={loan ? 'Кредит наличными' : 'Кредитная карта'}>
      {!loan && <div className="mb-5 flex justify-center"><BankCard size="lg" card={{ design, network, last4: '0000', exp: '••/••', holder: home.profile.name.toUpperCase(), form: 'virtual', status: 'active', kind: 'credit', tariff: 'standard' }} /></div>}
      <Card className="flex flex-col gap-5">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted">{loan ? 'Сумма кредита' : 'Кредитный лимит'}</span>
            <span className="text-[26px] font-semibold num">{money(amount)}</span>
          </div>
          <input type="range" min={min} max={max} step={step} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-brand)]" aria-label="Сумма" />
          <div className="flex justify-between text-xs text-faint num"><span>{money(min)}</span><span>{money(max)}</span></div>
        </div>
        {loan ? (
          <>
            <div>
              <div className="flex items-baseline justify-between"><span className="text-sm text-muted">Срок</span><span className="text-lg font-semibold">{term} мес.</span></div>
              <input type="range" min={3} max={60} step={1} value={term} onChange={(e) => setTerm(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-brand)]" aria-label="Срок" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-sunken p-3"><div className="text-xs text-muted">Ставка</div><div className="text-lg font-semibold">от {p.loanRate}%</div></div>
              <div className="rounded-2xl bg-sunken p-3"><div className="text-xs text-muted">Платёж в месяц</div><div className="text-lg font-semibold num">{money(annuity(amount, p.loanRate, term))}</div></div>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2">
              {(['mir', 'visa', 'mastercard', 'unionpay'] as Network[]).map((n) => (
                <button key={n} type="button" onClick={() => setNetwork(n)} className={cx('flex h-14 items-center justify-center rounded-2xl border-2 bg-sunken', network === n ? 'border-brand' : 'border-transparent')}><NetworkLogo network={n} className="h-7 w-11" /></button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {['black', 'green', 'white', 'silver'].map((d) => <button key={d} type="button" aria-label={d} onClick={() => setDesign(d)} className={cx('h-10 w-16 rounded-lg ring-offset-2 ring-offset-surface border border-line', design === d && 'ring-2 ring-brand')} style={{ background: DESIGN_BG[d] }} />)}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-sunken p-3"><div className="text-xs text-muted">Без процентов</div><div className="text-lg font-semibold">{p.creditCardGraceDays} дней</div></div>
              <div className="rounded-2xl bg-sunken p-3"><div className="text-xs text-muted">Ставка после</div><div className="text-lg font-semibold">{p.creditCardRate}%</div></div>
            </div>
          </>
        )}
        <p className="text-xs text-muted">Решение примет автоматическая система за несколько секунд. Мы учитываем поступления на счета за последний месяц, срок обслуживания и текущие кредиты. Иногда заявку дополнительно проверяет специалист.</p>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button size="lg" variant="primary" loading={busy} onClick={() => void submit()}>Отправить заявку</Button>
      </Card>
    </Screen>
  );
}
