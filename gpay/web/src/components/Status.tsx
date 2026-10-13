import { Ban, CheckCircle2, Clock, RotateCcw, ShieldCheck } from 'lucide-react';
import { Badge } from './ui';

export function PaymentStatus({ status, refunded = 0, amount = 0 }: { status: string; refunded?: number; amount?: number }) {
  if (status === 'succeeded' && refunded >= amount && refunded > 0) return <Badge tone="neutral" icon={<RotateCcw className="size-3" />}>Возвращён</Badge>;
  if (status === 'succeeded' && refunded > 0) return <Badge tone="warn" icon={<RotateCcw className="size-3" />}>Частичный возврат</Badge>;
  if (status === 'succeeded') return <Badge tone="ok" icon={<CheckCircle2 className="size-3" />}>Оплачен</Badge>;
  if (status === 'waiting_for_capture') return <Badge tone="info" icon={<ShieldCheck className="size-3" />}>Ждёт списания</Badge>;
  if (status === 'pending') return <Badge tone="neutral" icon={<Clock className="size-3" />}>Ожидает оплаты</Badge>;
  return <Badge tone="bad" icon={<Ban className="size-3" />}>Отменён</Badge>;
}
