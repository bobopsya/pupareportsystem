import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, Card, ErrorNote, Field, Input, Loading, PageHeader, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';

interface S {
  fx: { USD: number; EUR: number; spread: number; updatedAt: number };
  products: {
    savingsRate: number; deposits: { months: number; rate: number }[]; loanRate: number; loanMin: number; loanMax: number; creditCardRate: number; creditCardGraceDays: number;
    creditCardMax: number; minPaymentPct: number; latePenalty: number; scoreApprove: number; scoreReject: number;
  };
}

export function SettingsPage() {
  const toast = useToast();
  const { data, refetch } = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api<S>('/admin/settings') });
  const [form, setForm] = useState<S | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);
  if (!form) return <Loading />;
  const num = (v: string) => Number(v.replace(',', '.'));
  const p = form.products;
  const setP = (k: keyof S['products'], v: number) => setForm({ ...form, products: { ...p, [k]: v } });
  const save = async () => {
    setErr(null);
    try {
      await api('/admin/settings', { body: { fx: { USD: form.fx.USD, EUR: form.fx.EUR, spread: form.fx.spread }, products: p } });
      toast('Сохранено');
      await refetch();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  const rub = (k: 'loanMin' | 'loanMax' | 'creditCardMax' | 'latePenalty') => <Input inputMode="decimal" value={String(p[k] / 100)} onChange={(e) => setP(k, Math.round(num(e.target.value) * 100) || 0)} />;
  const pct = (k: keyof S['products']) => <Input inputMode="decimal" value={String(p[k])} onChange={(e) => setP(k, num(e.target.value) || 0)} />;
  return (
    <>
      <PageHeader title="Ставки и курсы" actions={<Button variant="primary" onClick={() => void save()}>Сохранить</Button>} />
      {err && <div className="mb-4"><ErrorNote>{err}</ErrorNote></div>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-4">
          <h2 className="font-extrabold">Курсы валют (₽ за единицу)</h2>
          <div className="grid grid-cols-3 gap-3">
            <Field label="USD"><Input inputMode="decimal" value={String(form.fx.USD)} onChange={(e) => setForm({ ...form, fx: { ...form.fx, USD: num(e.target.value) } })} /></Field>
            <Field label="EUR"><Input inputMode="decimal" value={String(form.fx.EUR)} onChange={(e) => setForm({ ...form, fx: { ...form.fx, EUR: num(e.target.value) } })} /></Field>
            <Field label="Спред, %"><Input inputMode="decimal" value={String(form.fx.spread)} onChange={(e) => setForm({ ...form, fx: { ...form.fx, spread: num(e.target.value) } })} /></Field>
          </div>
        </Card>
        <Card className="flex flex-col gap-4">
          <h2 className="font-extrabold">Вклады</h2>
          <Field label="Накопительный счёт, % годовых">{pct('savingsRate')}</Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {p.deposits.map((d, i) => (
              <Field key={d.months} label={`${d.months} мес., %`}>
                <Input inputMode="decimal" value={String(d.rate)} onChange={(e) => setForm({ ...form, products: { ...p, deposits: p.deposits.map((x, j) => (j === i ? { ...x, rate: num(e.target.value) || 0 } : x)) } })} />
              </Field>
            ))}
          </div>
        </Card>
        <Card className="flex flex-col gap-4">
          <h2 className="font-extrabold">Кредиты</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Ставка, %">{pct('loanRate')}</Field>
            <Field label="Минимум, ₽">{rub('loanMin')}</Field>
            <Field label="Максимум, ₽">{rub('loanMax')}</Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Кредитка, %">{pct('creditCardRate')}</Field>
            <Field label="Льготный период, дн.">{pct('creditCardGraceDays')}</Field>
            <Field label="Макс. лимит, ₽">{rub('creditCardMax')}</Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Минимальный платёж, %">{pct('minPaymentPct')}</Field>
            <Field label="Штраф за пропуск, ₽">{rub('latePenalty')}</Field>
          </div>
        </Card>
        <Card className="flex flex-col gap-4">
          <h2 className="font-extrabold">Скоринг</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Автоодобрение от" hint="Баллы 300–900">{pct('scoreApprove')}</Field>
            <Field label="Автоотказ ниже">{pct('scoreReject')}</Field>
          </div>
          <p className="text-sm text-muted">Между порогами заявка уходит на ручную проверку в раздел «Заявки на кредит».</p>
        </Card>
      </div>
    </>
  );
}
