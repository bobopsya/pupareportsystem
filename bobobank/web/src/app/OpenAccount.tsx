import { Briefcase, DollarSign, Euro, PiggyBank, Wallet } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen } from '../components/Screen';
import { Button, Card, ErrorNote, Field, Input, Segmented } from '../components/ui';
import { api, errorText } from '../lib/api';
import { useRefresh } from '../lib/hooks';
import type { Account } from '../lib/types';

export default function OpenAccount() {
  const nav = useNavigate();
  const refresh = useRefresh();
  const [biz, setBiz] = useState(false);
  const [type, setType] = useState<'ip' | 'ooo'>('ip');
  const [legalName, setLegalName] = useState('');
  const [inn, setInn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async (body: object) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ account: Account }>('/accounts', { body });
      refresh();
      nav(`/app/accounts/${r.account.id}`, { replace: true });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (biz) {
    return (
      <Screen title="Счёт для бизнеса" back={null} actions={<Button size="sm" variant="ghost" onClick={() => setBiz(false)}>Назад</Button>}>
        <Card className="flex flex-col gap-4">
          <Segmented value={type} onChange={setType} options={[{ value: 'ip', label: 'ИП' }, { value: 'ooo', label: 'ООО' }]} />
          <Field label={type === 'ip' ? 'ФИО предпринимателя' : 'Название организации'} hint={type === 'ooo' ? 'Без «ООО» и кавычек' : undefined}>
            <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder={type === 'ip' ? 'Петров Иван Иванович' : 'Ромашка'} />
          </Field>
          <Field label="ИНН" hint={type === 'ip' ? '12 цифр' : '10 цифр'}>
            <Input inputMode="numeric" value={inn} onChange={(e) => setInn(e.target.value.replace(/\D/g, '').slice(0, 12))} />
          </Field>
          <p className="text-sm text-muted">Счёт откроется сразу. К нему можно выпустить карту и подключить выплаты выручки из GPAY.</p>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button size="lg" variant="primary" loading={busy} onClick={() => void open({ kind: 'business', businessType: type, legalName, inn })}>Открыть счёт</Button>
        </Card>
      </Screen>
    );
  }
  return (
    <Screen title="Открыть счёт">
      {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Opt icon={<Wallet className="size-6" />} title="Платёжный в рублях" text="Для зарплаты, переводов и карт" onClick={() => void open({ kind: 'current', currency: 'RUB' })} disabled={busy} />
        <Opt icon={<DollarSign className="size-6" />} title="Счёт в долларах" text="Покупка валюты по курсу банка" onClick={() => void open({ kind: 'current', currency: 'USD' })} disabled={busy} />
        <Opt icon={<Euro className="size-6" />} title="Счёт в евро" text="Покупка валюты по курсу банка" onClick={() => void open({ kind: 'current', currency: 'EUR' })} disabled={busy} />
        <Opt icon={<PiggyBank className="size-6" />} title="Накопительный счёт" text="Проценты каждый день, снимайте когда угодно" onClick={() => void open({ kind: 'savings', currency: 'RUB' })} disabled={busy} />
        <Opt icon={<PiggyBank className="size-6" />} title="Вклад" text="Ставка выше, срок от 3 месяцев" onClick={() => nav('/app/savings')} />
        <Opt icon={<Briefcase className="size-6" />} title="Для бизнеса" text="ИП или ООО, выплаты из GPAY" onClick={() => setBiz(true)} />
      </div>
    </Screen>
  );
}

function Opt({ icon, title, text, onClick, disabled }: { icon: ReactNode; title: string; text: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="flex items-start gap-3 rounded-2xl bg-surface p-4 text-left shadow-card active:scale-[0.99] disabled:opacity-60">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand">{icon}</span>
      <span><span className="block text-[17px] font-semibold">{title}</span><span className="block text-sm text-muted">{text}</span></span>
    </button>
  );
}
