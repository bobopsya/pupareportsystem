import { CheckCircle2, Download, Printer, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { Button, Loading } from '../components/ui';
import { api, errorText } from '../lib/api';
import { dateTime, money } from '../lib/format';

interface Quittance {
  shopName: string;
  legalName: string;
  inn: string;
  amount: number;
  currency: string;
  description: string;
  method: string;
  paymentId: string;
  operationId: string;
  rrn: string;
  authCode: string;
  ts: number;
  refunded: number;
}

export default function QuittancePage() {
  const { id = '' } = useParams();
  const [q, setQ] = useState<Quittance | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ quittance: Quittance }>(`/checkout/payments/${id}/quittance`).then((r) => setQ(r.quittance), (e) => setError(errorText(e)));
    document.title = 'Квитанция об оплате — GPAY';
  }, [id]);
  if (error) return <div className="min-h-screen flex items-center justify-center text-sm text-muted">{error}</div>;
  if (!q) return <Loading />;
  const rows: [string, string][] = [
    ['Дата и время (МСК)', dateTime(q.ts)],
    ['Получатель', q.shopName],
    ['Юридическое лицо', q.legalName],
    ['ИНН получателя', q.inn],
    ...(q.description ? [['Назначение', q.description] as [string, string]] : []),
    ['Способ оплаты', q.method],
    ['Номер платежа', q.paymentId],
    ['Номер операции', q.operationId],
    ...(q.rrn ? [['RRN', q.rrn] as [string, string]] : []),
    ...(q.authCode ? [['Код авторизации', q.authCode] as [string, string]] : []),
  ];
  const refundedAll = q.refunded >= q.amount;
  return (
    <div className="min-h-screen bg-sunken py-8 px-3 flex flex-col items-center gap-5">
      <div className="no-print flex items-center justify-between w-full max-w-[460px]">
        <Logo size="sm" />
        <div className="flex gap-1.5">
          <Button size="sm" icon={<Printer className="size-3.5" />} onClick={() => window.print()}>Печать</Button>
          <a href={`/api/checkout/payments/${id}/quittance.pdf`}>
            <Button size="sm" variant="primary" icon={<Download className="size-3.5" />}>PDF</Button>
          </a>
        </div>
      </div>
      <article className="w-full max-w-[460px] rounded-[32px] bg-surface overflow-hidden">
        <div className="px-6 pt-8 pb-6 text-center">
          <div className="text-[15px] text-muted">Квитанция об оплате</div>
          <div className="mt-2 text-[38px] font-bold tracking-[-0.02em]">{money(q.amount, q.currency, { exact: true })}</div>
          <div className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${q.refunded ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>
            {q.refunded ? <RotateCcw className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
            {refundedAll ? 'Возвращён' : q.refunded ? `Возвращено ${money(q.refunded, q.currency)}` : 'Успешно'}
          </div>
        </div>
        <dl className="px-6 pb-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-6 py-2.5 border-b border-line last:border-0 text-sm">
              <dt className="text-muted shrink-0">{k}</dt>
              <dd className="text-right break-all">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mx-6 mb-6 mt-2 rounded-2xl border-2 border-fg/70 text-fg/80 text-center py-3 -rotate-1">
          <div className="font-bold tracking-[0.2em] text-sm">ПРОВЕДЕНО</div>
          <div className="text-[11px] opacity-80 font-mono">GPAY · {dateTime(q.ts)}</div>
        </div>
      </article>
      <p className="no-print text-xs text-faint text-center max-w-[460px]">Квитанция сформирована автоматически и подтверждает проведение платежа через GPAY (GnusaPay).</p>
    </div>
  );
}
