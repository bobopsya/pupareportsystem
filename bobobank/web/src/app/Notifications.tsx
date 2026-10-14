import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CreditCard, Gift, Landmark, ShieldAlert, ShoppingBag, Store, Wallet } from 'lucide-react';
import { useEffect } from 'react';
import { Screen } from '../components/Screen';
import { Card, Loading, cx } from '../components/ui';
import { api } from '../lib/api';
import { ago } from '../lib/format';

const ICON: Record<string, typeof Bell> = { income: Wallet, debit: Wallet, purchase: ShoppingBag, purchase_confirm: ShoppingBag, refund: ShoppingBag, card: CreditCard, credit: Landmark, deposit: Landmark, restriction: ShieldAlert, bonus: Gift, tariff: Gift, gpay: Store };

export default function Notifications() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ items: { id: number; kind: string; title: string; body: string; createdAt: number; readAt: number | null }[] }>('/notifications') });
  useEffect(() => {
    if (data?.items.some((i) => !i.readAt)) void api('/notifications/read', { body: {} }).then(() => qc.invalidateQueries({ queryKey: ['pulse'] }));
  }, [data, qc]);
  if (!data) return <Loading />;
  return (
    <Screen title="Уведомления">
      <Card pad={false} className="overflow-hidden">
        {data.items.length ? data.items.map((n) => {
          const Icon = ICON[n.kind] ?? Bell;
          return (
            <div key={n.id} className={cx('flex gap-3 border-b border-line px-4 py-3.5 last:border-0', !n.readAt && 'bg-brand-soft/50')}>
              <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-full', n.kind === 'restriction' ? 'bg-bad-soft text-bad' : 'bg-brand-soft text-brand')}><Icon className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{n.title}</div>
                {n.body && <div className="text-sm text-muted">{n.body}</div>}
                <div className="mt-0.5 text-xs text-faint">{ago(n.createdAt)}</div>
              </div>
            </div>
          );
        }) : <div className="px-5 py-12 text-center text-muted">Уведомлений пока нет</div>}
      </Card>
    </Screen>
  );
}
