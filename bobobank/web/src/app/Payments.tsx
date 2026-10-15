import { ArrowLeftRight, Building2, CreditCard, QrCode, Repeat, ScanLine, Smartphone } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Favorites } from '../components/Favorites';
import { SbpMark } from '../components/PaymentLogos';
import { Row, Screen } from '../components/Screen';
import { Button, Card, ErrorNote, Input } from '../components/ui';
import { SectionTitle } from './Shell';

/** Pulls a GPAY payment id out of a pasted QR link (bank /sbp/pay?payment=…, GPAY /pay/… or a bare id). */
export function parsePaymentRef(s: string): string | null {
  const t = s.trim();
  const m = /[?&]payment=([A-Za-z0-9_-]+)/.exec(t) ?? /\/pay\/([A-Za-z0-9_-]+)/.exec(t) ?? /^(pay_[A-Za-z0-9]+)$/.exec(t);
  return m ? m[1] : null;
}

export default function Payments() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const from = params.get('from');
  const q = from ? `?from=${from}` : '';
  const [link, setLink] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const openLink = () => {
    const id = parsePaymentRef(link);
    if (!id) return setErr('Не похоже на ссылку из QR-кода GPAY');
    nav(`/sbp/pay?payment=${id}`);
  };
  return (
    <Screen title="Платежи и переводы" back={null}>
      <div className="mb-3"><Favorites /></div>
      <Card pad={false} className="divide-y divide-line overflow-hidden">
        <Row icon={<Ico><Smartphone className="size-5" /></Ico>} title="По номеру телефона" sub="Клиенту Bobobank — мгновенно" onClick={() => nav(`/app/transfer/phone${q}`)} right={<SbpMark className="h-6 w-6" />} />
        <Row icon={<Ico><CreditCard className="size-5" /></Ico>} title="По номеру карты" sub="На карту Bobobank" onClick={() => nav(`/app/transfer/card${q}`)} />
        <Row icon={<Ico><ArrowLeftRight className="size-5" /></Ico>} title="Между своими счетами" sub="Без комиссии" onClick={() => nav(`/app/transfer/own${from ? `?from=${from}` : ''}`)} />
        <Row icon={<Ico><Building2 className="size-5" /></Ico>} title="По реквизитам" sub="На счёт в любом банке" onClick={() => nav(`/app/transfer/account${q}`)} />
        <Row icon={<Ico><Repeat className="size-5" /></Ico>} title="Обмен валют" sub="Доллары и евро по курсу банка" onClick={() => nav('/app/exchange')} />
      </Card>

      <SectionTitle>Оплата по QR-коду</SectionTitle>
      <Card id="qr">
        <div className="flex items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-brand"><QrCode className="size-6" /></span>
          <div className="min-w-0">
            <div className="font-semibold">Оплатить покупку через СБП</div>
            <p className="text-sm text-muted">Наведите камеру телефона на QR-код на странице оплаты GPAY — откроется Bobobank. Или вставьте ссылку из кода.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input value={link} onChange={(e) => (setLink(e.target.value), setErr(null))} placeholder="Ссылка или номер платежа pay_…" />
          <Button variant="primary" icon={<ScanLine className="size-4" />} onClick={openLink} disabled={!link.trim()}>Оплатить</Button>
        </div>
        {err && <div className="mt-3"><ErrorNote>{err}</ErrorNote></div>}
      </Card>
    </Screen>
  );
}

function Ico({ children }: { children: ReactNode }) {
  return <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">{children}</span>;
}
