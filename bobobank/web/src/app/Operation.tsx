import { useQuery } from '@tanstack/react-query';
import { FileText, MessageCircle, Repeat } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { CategoryIcon } from '../components/CategoryIcon';
import { Screen } from '../components/Screen';
import { Button, Card, ErrorNote, Loading, cx } from '../components/ui';
import { api, errorText } from '../lib/api';
import { dateTime, money } from '../lib/format';
import type { Entry } from '../lib/types';

const KIND: Record<string, string> = {
  transfer: 'Перевод', own_transfer: 'Перевод между счетами', purchase: 'Покупка', refund: 'Возврат покупки', fx: 'Обмен валюты', sbp_payment: 'Оплата по QR (СБП)', sbp_reversal: 'Отмена оплаты СБП',
  gpay_payout: 'Выплата из GPAY', loan_issue: 'Выдача кредита', loan_payment: 'Платёж по кредиту', loan_repay: 'Погашение кредита', interest: 'Проценты', admin_credit: 'Зачисление', admin_debit: 'Списание', deposit_open: 'Открытие вклада',
  deposit_close: 'Закрытие вклада', interest_forfeit: 'Удержание процентов', bonus_redeem: 'Обмен бонусов', fee: 'Комиссия', penalty: 'Штраф',
};

export default function Operation() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { data, error } = useQuery({ queryKey: ['history', 'op', id], queryFn: () => api<{ entry: Entry; meta: { comment?: string; fee?: number; rate?: number }; account: { number: string; name: string } }>(`/history/${id}`) });
  if (error) return <ErrorNote>{errorText(error)}</ErrorNote>;
  if (!data) return <Loading />;
  const e = data.entry;
  return (
    <Screen title={KIND[e.kind] ?? 'Операция'}>
      <Card className="flex flex-col items-center text-center">
        <CategoryIcon category={e.category} size="lg" />
        <div className="mt-3 text-lg font-semibold">{e.title}</div>
        <div className="text-sm text-muted">{e.subtitle}</div>
        <div className={cx('mt-3 text-[34px] font-semibold num', e.amount > 0 && 'text-ok')}>{money(e.amount, e.currency, { sign: true, exact: true })}</div>
        <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-sm font-semibold text-brand-strong dark:text-brand">Выполнено</div>
      </Card>
      <Card className="mt-3 divide-y divide-line !py-1">
        {([
          ['Дата', dateTime(e.createdAt)],
          ['Категория', e.categoryTitle],
          [e.amount < 0 ? 'Счёт списания' : 'Счёт зачисления', `${data.account.name} •• ${data.account.number.slice(-4)}`],
          ...(e.card ? [['Карта', `•• ${e.card.last4}`]] : []),
          ...(data.meta.comment ? [['Сообщение', data.meta.comment]] : []),
          ...(data.meta.fee ? [['Комиссия', money(data.meta.fee, e.currency, { exact: true })]] : []),
          ['Остаток после операции', money(e.balanceAfter, e.currency, { exact: true })],
          ['Номер операции', e.txId],
        ] as [string, string][]).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-3 text-sm">
            <span className="text-muted">{k}</span>
            <span className="min-w-0 break-all text-right font-semibold">{v}</span>
          </div>
        ))}
      </Card>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button icon={<FileText className="size-4" />} onClick={() => window.open(`/api/history/${e.id}/receipt.pdf`, '_blank')}>Чек</Button>
        {e.kind === 'transfer' && e.amount < 0 && <Button icon={<Repeat className="size-4" />} onClick={() => nav('/app/payments')}>Повторить</Button>}
        <Button icon={<MessageCircle className="size-4" />} onClick={() => nav('/app/chat')}>Вопрос по операции</Button>
      </div>
    </Screen>
  );
}
