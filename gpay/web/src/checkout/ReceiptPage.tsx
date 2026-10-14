import { Download, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { QR } from '../components/QR';
import { Button, cx, Loading } from '../components/ui';
import { api, errorText } from '../lib/api';

interface FiscalReceipt {
  kind: 'income' | 'income_return';
  currency: string;
  seller: { name: string; legalName: string; inn: string; site: string; taxSystem: string };
  items: { name: string; quantity: number; price: number; sum: number; vat: string; vatSum: number; subject: string; mode: string }[];
  total: number;
  vatTotals: { label: string; sum: number }[];
  method: string;
  customerEmail: string | null;
  kkt: { rn: string; zn: string; fn: string; fd: number; fpd: string; shift: number; checkNo: number; ts: number };
  ofd: { name: string; inn: string; site: string };
  qr: string;
}

const n = (minor: number) => (minor / 100).toFixed(2);
const msk = (ts: number) => new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ts).replace(',', '');

function Row({ k, v, bold, className }: { k: React.ReactNode; v?: React.ReactNode; bold?: boolean; className?: string }) {
  return (
    <div className={cx('flex justify-between gap-3', bold && 'font-bold', className)}>
      <span className="min-w-0 break-words">{k}</span>
      {v !== undefined && <span className="shrink-0 text-right">{v}</span>}
    </div>
  );
}

const Dash = () => <div className="my-2.5 border-t border-dashed border-[#bdbdc6]" />;

export default function ReceiptPage() {
  const { id = '' } = useParams();
  const [data, setData] = useState<{ receipt: FiscalReceipt; paymentId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ receipt: FiscalReceipt; paymentId: string }>(`/checkout/receipts/${id}`).then(setData, (e) => setError(errorText(e)));
    document.title = 'Кассовый чек — GPAY ОФД';
  }, [id]);

  if (error) return <div className="min-h-screen flex items-center justify-center text-sm text-muted">{error}</div>;
  if (!data) return <Loading />;
  const r = data.receipt;

  return (
    <div className="min-h-screen bg-sunken py-8 px-3 flex flex-col items-center gap-5">
      <div className="no-print flex items-center justify-between w-full max-w-[360px]">
        <Logo size="sm" suffix="ОФД" />
        <div className="flex gap-1.5">
          <Button size="sm" icon={<Printer className="size-3.5" />} onClick={() => window.print()}>Печать</Button>
          <a href={`/api/checkout/receipts/${id}/pdf`}>
            <Button size="sm" variant="primary" icon={<Download className="size-3.5" />}>PDF</Button>
          </a>
        </div>
      </div>
      <article className="gp-tape [--tape-edge:var(--color-sunken)] w-full max-w-[360px] bg-white text-[#16161d] font-mono text-[12px] leading-[1.45] px-6 py-9">
        <div className="text-center">
          <div className="font-bold">{r.seller.legalName}</div>
          <div>ИНН {r.seller.inn}</div>
          {r.seller.site && <div className="break-all">Место расчётов: {r.seller.site}</div>}
          <div className="mt-3 text-[15px] font-bold tracking-wide">КАССОВЫЙ ЧЕК</div>
          <div className="text-[13px] font-bold">{r.kind === 'income' ? 'ПРИХОД' : 'ВОЗВРАТ ПРИХОДА'}</div>
        </div>
        <div className="mt-3">
          <Row k={`СМЕНА № ${r.kkt.shift}`} v={`ЧЕК № ${r.kkt.checkNo}`} />
          <Row k={msk(r.kkt.ts)} v={`ФД № ${r.kkt.fd}`} />
        </div>
        <Dash />
        {r.items.map((it, i) => (
          <div key={i} className="mb-2.5">
            <div className="font-bold">{i + 1}. {it.name}</div>
            <Row k={`${it.quantity} x ${n(it.price)}`} v={`=${n(it.sum)}`} className="pl-3" />
            <Row k={it.vat} v={it.vatSum ? `=${n(it.vatSum)}` : ''} className="pl-3" />
            <div className="pl-3">{it.subject}</div>
            <div className="pl-3">{it.mode}</div>
          </div>
        ))}
        <Dash />
        <Row k="ИТОГ" v={`=${n(r.total)}`} bold className="text-[15px]" />
        <Row k={r.method} v={`=${n(r.total)}`} />
        {r.vatTotals.map((v) => <Row key={v.label} k={`СУММА ${v.label}`} v={`=${n(v.sum)}`} />)}
        <Dash />
        <Row k="СНО" v={r.seller.taxSystem} />
        {r.customerEmail && <Row k="ЭЛ. АДР. ПОКУПАТЕЛЯ" v={<span className="break-all">{r.customerEmail}</span>} />}
        <Row k="САЙТ ПРОВЕРКИ" v={r.ofd.site.replace(/^https?:\/\//, '')} />
        <Row k="ОФД" v={r.ofd.name} />
        <Row k="ИНН ОФД" v={r.ofd.inn} />
        <Dash />
        <Row k="РН ККТ" v={r.kkt.rn} />
        <Row k="ЗН ККТ" v={r.kkt.zn} />
        <Row k="ФН" v={r.kkt.fn} />
        <Row k="ФД" v={r.kkt.fd} />
        <Row k="ФП" v={r.kkt.fpd} />
        <div className="mt-4 flex justify-center">
          <QR text={r.qr} className="size-32" dark="#16161d" />
        </div>
        <div className="mt-3 text-center">Спасибо за покупку!</div>
      </article>
      <p className="no-print text-xs text-faint text-center max-w-[360px]">Электронный чек сформирован онлайн-кассой и передан оператору фискальных данных {r.ofd.name}.</p>
    </div>
  );
}
