import { CreditCard } from 'lucide-react';
import { BoboMark } from '../checkout/AsyncMethods';
import { useNavigate } from 'react-router-dom';
import { PayLogo, SbpMark } from '../components/PaymentLogos';
import { PaymentStatus } from '../components/Status';
import { cx } from '../components/ui';
import { dateTime, money } from '../lib/format';
import type { PaymentRowT } from './types';

const CARD_LOGO: Record<string, 'visa' | 'mastercard' | 'mir' | 'unionpay'> = { Visa: 'visa', Mastercard: 'mastercard', МИР: 'mir', UnionPay: 'unionpay' };

export function MethodCell({ p }: { p: Pick<PaymentRowT, 'methodType' | 'methodTitle' | 'cardBrand'> }) {
  if (!p.methodType) return <span className="text-faint">—</span>;
  const icon =
    p.methodType === 'bank_card' && p.cardBrand ? <PayLogo name={CARD_LOGO[p.cardBrand] ?? 'visa'} className="!h-5 !w-8" /> :
    p.methodType === 'bank_card' ? <CreditCard className="size-4 text-muted" /> :
    p.methodType === 'sbp' ? <span className="flex h-5 w-8 items-center justify-center rounded-[5px] border border-[#e5e7ef] bg-white"><SbpMark className="size-3.5" /></span> :
    <BoboMark className="h-5 w-5" />;
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      {icon}
      <span className="truncate text-muted">{p.methodType === 'bank_card' ? `•• ${p.methodTitle?.slice(-4) ?? ''}` : p.methodTitle}</span>
    </span>
  );
}

export function PaymentsTable({ items, shopId, compact }: { items: PaymentRowT[]; shopId: number; compact?: boolean }) {
  const navigate = useNavigate();
  const open = (id: string) => navigate(`/app/${shopId}/payments/${id}`);
  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[13px] text-faint border-b border-line">
              <th className="font-normal py-3 pl-5 pr-3">Сумма</th>
              <th className="font-normal py-3 px-3">Статус</th>
              <th className="font-normal py-3 px-3">Описание</th>
              <th className="font-normal py-3 px-3">Способ</th>
              {!compact && <th className="font-normal py-3 px-3">Покупатель</th>}
              <th className="font-normal py-3 pl-3 pr-5 text-right">Дата</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} onClick={() => open(p.id)} className="border-b border-line last:border-0 hover:bg-sunken/70 cursor-pointer">
                <td className="py-4 pl-5 pr-3 whitespace-nowrap">
                  <span className={cx('font-semibold tabular-nums', p.status === 'canceled' && 'text-muted line-through decoration-faint')}>{money(p.amount, p.currency, { exact: true })}</span>
                  <span className="ml-1.5 text-xs text-faint">{p.currency}</span>
                </td>
                <td className="py-4 px-3"><PaymentStatus status={p.status} refunded={p.refunded} amount={p.amount} /></td>
                <td className="py-4 px-3 max-w-[260px]"><div className="truncate">{p.description || <span className="text-faint">—</span>}</div><div className="text-[11px] text-faint font-mono truncate">{p.id}</div></td>
                <td className="py-4 px-3 max-w-[160px]"><MethodCell p={p} /></td>
                {!compact && <td className="py-4 px-3 max-w-[200px] truncate text-muted">{p.email ?? '—'}</td>}
                <td className="py-4 pl-3 pr-5 text-right whitespace-nowrap text-muted">{dateTime(p.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile list */}
      <ul className="md:hidden divide-y divide-line">
        {items.map((p) => (
          <li key={p.id} onClick={() => open(p.id)} className="px-4 py-3 flex items-center gap-3 active:bg-hover">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold tabular-nums">{money(p.amount, p.currency, { exact: true })}</span>
                <PaymentStatus status={p.status} refunded={p.refunded} amount={p.amount} />
              </div>
              <div className="text-[13px] text-muted truncate mt-0.5">{p.description || p.id}</div>
            </div>
            <div className="text-right shrink-0">
              <MethodCell p={p} />
              <div className="text-[11px] text-faint mt-0.5">{dateTime(p.createdAt)}</div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
