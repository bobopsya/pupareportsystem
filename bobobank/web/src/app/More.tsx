import { BarChart3, Gift, Landmark, PiggyBank, Plus, Repeat, Shield, UserRound, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Row, Screen } from '../components/Screen';
import { Card } from '../components/ui';
import { useAuth } from '../lib/auth';

export default function More() {
  const nav = useNavigate();
  const { user } = useAuth();
  const items = [
    { icon: BarChart3, title: 'Расходы и аналитика', to: '/app/analytics' },
    { icon: Landmark, title: 'Кредиты', to: '/app/credits' },
    { icon: PiggyBank, title: 'Вклады и накопления', to: '/app/savings' },
    { icon: Gift, title: 'Бобобонусы и кешбэк', to: '/app/bonus' },
    { icon: Repeat, title: 'Обмен валют', to: '/app/exchange' },
    { icon: Plus, title: 'Новая карта', to: '/app/cards/new' },
    { icon: Wallet, title: 'Открыть счёт', to: '/app/accounts/new' },
    { icon: UserRound, title: 'Профиль и тариф', to: '/app/profile' },
    ...(user?.role === 'admin' || user?.role === 'support' ? [{ icon: Shield, title: user.role === 'admin' ? 'Админка банка' : 'Поддержка', to: '/admin' }] : []),
  ];
  return (
    <Screen title="Ещё" back={null}>
      <Card pad={false} className="divide-y divide-line overflow-hidden">
        {items.map((i) => <Row key={i.to} icon={<span className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand"><i.icon className="size-5" /></span>} title={i.title} onClick={() => nav(i.to)} />)}
      </Card>
    </Screen>
  );
}
