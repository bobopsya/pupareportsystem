import { StatusDot } from './ui';

export function PaymentStatus({ status, refunded = 0, amount = 0 }: { status: string; refunded?: number; amount?: number }) {
  if (status === 'succeeded' && refunded >= amount && refunded > 0) return <StatusDot tone="neutral">Возвращён</StatusDot>;
  if (status === 'succeeded' && refunded > 0) return <StatusDot tone="warn">Частичный возврат</StatusDot>;
  if (status === 'succeeded') return <StatusDot tone="ok">Оплачен</StatusDot>;
  if (status === 'waiting_for_capture') return <StatusDot tone="info">Ждёт списания</StatusDot>;
  if (status === 'pending') return <StatusDot tone="neutral">Ожидает оплаты</StatusDot>;
  return <StatusDot tone="bad">Отменён</StatusDot>;
}
