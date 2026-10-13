import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CreditCard, Plus, Search, ShieldHalf, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ShopAvatar } from '../checkout/Checkout';
import { Logo } from '../components/Logo';
import { PayLogo } from '../components/PaymentLogos';
import { PaymentStatus } from '../components/Status';
import { Badge, Button, Card, CardHeader, ErrorNote, Field, IconButton, Input, Loading, Modal, Segmented, Select, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { brandOf } from '../lib/cards';
import { dateTime, dateTimeSec, METHOD_TITLE, money } from '../lib/format';
import { Kpi } from '../merchant/Overview';
import { MethodCell } from '../merchant/PaymentsTable';
import type { PaymentRowT, Shop } from '../merchant/types';

type Tab = 'shops' | 'users' | 'payments' | 'settings' | 'cards' | 'audit';

export default function Admin() {
  const { user, ready } = useAuth();
  const [tab, setTab] = useState<Tab>('shops');
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/app" replace />;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 h-14 bg-bg/85 backdrop-blur border-b border-line">
        <div className="h-full max-w-[1280px] mx-auto px-4 sm:px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/app" className="flex size-8 items-center justify-center rounded-lg hover:bg-hover" aria-label="В кабинет"><ArrowLeft className="size-4" /></Link>
            <Logo size="sm" />
            <Badge tone="brand" icon={<ShieldHalf className="size-3" />}>Администрирование</Badge>
          </div>
          <span className="text-sm text-muted hidden sm:block">{user.email}</span>
        </div>
      </header>
      <main className="max-w-[1280px] mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
        <Stats />
        <div className="overflow-x-auto">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'shops', label: 'Магазины' },
              { value: 'users', label: 'Пользователи' },
              { value: 'payments', label: 'Платежи' },
              { value: 'settings', label: 'Курсы и комиссии' },
              { value: 'cards', label: 'Карты' },
              { value: 'audit', label: 'Журнал' },
            ]}
          />
        </div>
        {tab === 'shops' && <Shops />}
        {tab === 'users' && <Users />}
        {tab === 'payments' && <AllPayments />}
        {tab === 'settings' && <RatesFees />}
        {tab === 'cards' && <Cards />}
        {tab === 'audit' && <Audit />}
      </main>
    </div>
  );
}

function Stats() {
  const { data } = useQuery({ queryKey: ['admin-stats'], queryFn: () => api<{ users: number; shops: number; payments: number; succeeded: number; turnoverRub: number; feesRub: number; pendingWebhooks: number }>('/admin/stats'), refetchInterval: 15000 });
  if (!data) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Kpi label="Оборот (₽)" value={money(data.turnoverRub)} hint={`${data.succeeded} успешных из ${data.payments}`} />
      <Kpi label="Доход GPAY (₽)" value={money(data.feesRub)} hint="комиссии с успешных платежей" />
      <Kpi label="Магазины" value={String(data.shops)} hint={`${data.users} пользователей`} />
      <Kpi label="Вебхуки в очереди" value={String(data.pendingWebhooks)} hint="ожидают доставки" />
    </div>
  );
}

type AdminShop = Shop & { ownerEmail: string; ownFees: Record<string, number>; payments: number; gross: number };

function Shops() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['admin-shops'], queryFn: () => api<{ items: AdminShop[] }>('/admin/shops') });
  const [edit, setEdit] = useState<AdminShop | null>(null);
  if (!data) return <Loading />;
  const setStatus = async (s: AdminShop, status: 'active' | 'blocked') => {
    await api(`/admin/shops/${s.id}`, { method: 'PATCH', body: { status } });
    void qc.invalidateQueries({ queryKey: ['admin-shops'] });
    toast(status === 'blocked' ? 'Магазин заблокирован' : 'Магазин разблокирован');
  };
  return (
    <Card pad={false}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-faint border-b border-line">
              <th className="font-medium py-2.5 pl-5 pr-3">Магазин</th>
              <th className="font-medium py-2.5 px-3">Владелец</th>
              <th className="font-medium py-2.5 px-3">ИНН</th>
              <th className="font-medium py-2.5 px-3 text-right">Оборот</th>
              <th className="font-medium py-2.5 px-3">Комиссии</th>
              <th className="font-medium py-2.5 pl-3 pr-5 text-right">Статус</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((s) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className="py-3 pl-5 pr-3">
                  <div className="flex items-center gap-2.5">
                    <ShopAvatar shop={s} className="size-8 text-sm rounded-lg" />
                    <div className="min-w-0">
                      <Link to={`/app/${s.id}`} className="font-medium hover:text-brand">{s.name}</Link>
                      <div className="text-xs text-faint">ID {s.id} · {s.payments} платежей</div>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-3 text-muted">{s.ownerEmail}</td>
                <td className="py-3 px-3 font-mono text-xs">{s.inn}</td>
                <td className="py-3 px-3 text-right tabular-nums">{money(s.gross)}</td>
                <td className="py-3 px-3">
                  <button type="button" onClick={() => setEdit(s)} className="text-xs text-brand">
                    {Object.keys(s.ownFees).length ? 'индивидуальные' : 'стандартные'}
                  </button>
                </td>
                <td className="py-3 pl-3 pr-5 text-right">
                  {s.status === 'active' ? <Button size="sm" variant="danger" onClick={() => void setStatus(s, 'blocked')}>Заблокировать</Button> : <Button size="sm" onClick={() => void setStatus(s, 'active')}>Разблокировать</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <ShopFees shop={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function ShopFees({ shop, onClose }: { shop: AdminShop; onClose: () => void }) {
  const qc = useQueryClient();
  const [fees, setFees] = useState<Record<string, string>>(Object.fromEntries(Object.entries(shop.fees).map(([k, v]) => [k, String(v)])));
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Комиссии · ${shop.name}`}
      footer={
        <>
          <Button
            onClick={async () => {
              await api(`/admin/shops/${shop.id}`, { method: 'PATCH', body: { fees: {} } });
              void qc.invalidateQueries({ queryKey: ['admin-shops'] });
              onClose();
            }}
          >
            Сбросить к стандартным
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await api(`/admin/shops/${shop.id}`, { method: 'PATCH', body: { fees: Object.fromEntries(Object.entries(fees).map(([k, v]) => [k, Number(v.replace(',', '.'))])) } });
                void qc.invalidateQueries({ queryKey: ['admin-shops'] });
                onClose();
              } catch (e) {
                setError(errorText(e));
              }
            }}
          >
            Сохранить
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {Object.keys(fees).map((k) => (
          <Field key={k} label={`${METHOD_TITLE[k]}, %`}>
            <Input inputMode="decimal" value={fees[k]} onChange={(e) => setFees({ ...fees, [k]: e.target.value })} />
          </Field>
        ))}
      </div>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
    </Modal>
  );
}

function Users() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data } = useQuery({ queryKey: ['admin-users'], queryFn: () => api<{ items: { id: string; email: string; name: string; role: string; blocked: number; createdAt: number; shops: number }[] }>('/admin/users') });
  if (!data) return <Loading />;
  const patch = async (id: string, body: object) => {
    await api(`/admin/users/${id}`, { method: 'PATCH', body });
    void qc.invalidateQueries({ queryKey: ['admin-users'] });
  };
  return (
    <Card pad={false}>
      <ul className="divide-y divide-line">
        {data.items.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <span className="flex size-8 items-center justify-center rounded-full bg-sunken border border-line text-xs font-semibold">{u.name[0]?.toUpperCase()}</span>
            <span className="flex-1 min-w-[200px]">
              <span className="block font-medium">{u.name} {u.role === 'admin' && <Badge tone="brand">admin</Badge>} {u.blocked ? <Badge tone="bad">заблокирован</Badge> : null}</span>
              <span className="block text-xs text-muted">{u.email} · магазинов: {u.shops} · с {dateTime(u.createdAt)}</span>
            </span>
            {u.id !== user?.id && (
              <>
                <Button size="sm" onClick={() => void patch(u.id, { role: u.role === 'admin' ? 'merchant' : 'admin' })}>{u.role === 'admin' ? 'Снять админа' : 'Сделать админом'}</Button>
                <Button size="sm" variant={u.blocked ? 'secondary' : 'danger'} onClick={() => void patch(u.id, { blocked: !u.blocked })}>{u.blocked ? 'Разблокировать' : 'Заблокировать'}</Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AllPayments() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const { data } = useQuery({
    queryKey: ['admin-payments', q, status],
    queryFn: () => api<{ items: (PaymentRowT & { shopName: string })[] }>(`/admin/payments?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { status } : {}) })}`),
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-faint" />
          <Input placeholder="ID, описание, магазин, email" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
          <option value="">Все</option>
          <option value="succeeded">Оплачен</option>
          <option value="pending">Ожидает</option>
          <option value="waiting_for_capture">Ждёт списания</option>
          <option value="canceled">Отменён</option>
        </Select>
      </div>
      <Card pad={false}>
        {!data ? <Loading /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="py-2.5 pl-5 pr-3 font-semibold tabular-nums whitespace-nowrap">{money(p.amount, p.currency, { exact: true })}</td>
                    <td className="py-2.5 px-3"><PaymentStatus status={p.status} refunded={p.refunded} amount={p.amount} /></td>
                    <td className="py-2.5 px-3"><Link to={`/app/${p.shopId}/payments/${p.id}`} className="hover:text-brand">{p.shopName}</Link><div className="text-[11px] text-faint font-mono">{p.id}</div></td>
                    <td className="py-2.5 px-3 max-w-[200px] truncate text-muted">{p.description}</td>
                    <td className="py-2.5 px-3"><MethodCell p={p} /></td>
                    <td className="py-2.5 pl-3 pr-5 text-right text-muted whitespace-nowrap">{dateTime(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function RatesFees() {
  const toast = useToast();
  const { data, refetch } = useQuery({ queryKey: ['admin-settings'], queryFn: () => api<{ rates: Record<string, number>; fees: Record<string, number> }>('/admin/settings') });
  const [rates, setRates] = useState<Record<string, string> | null>(null);
  const [fees, setFees] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!data) return <Loading />;
  const r = rates ?? Object.fromEntries(['USD', 'EUR', 'USDT', 'BTC'].map((k) => [k, String(data.rates[k])]));
  const f = fees ?? Object.fromEntries(Object.entries(data.fees).map(([k, v]) => [k, String(v)]));
  const num = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v.replace(',', '.'))]));
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader title="Курсы валют" sub={`Рублей за единицу · обновлено ${data.rates.updatedAt ? dateTime(data.rates.updatedAt) : 'никогда'}`} />
        <div className="grid grid-cols-2 gap-3">
          {Object.keys(r).map((k) => (
            <Field key={k} label={k === 'USDT' ? 'USDT (Tether)' : k === 'BTC' ? 'BTC (Bitcoin)' : k}>
              <Input inputMode="decimal" value={r[k]} onChange={(e) => setRates({ ...r, [k]: e.target.value })} mono />
            </Field>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={async () => {
            try {
              await api('/admin/rates', { method: 'PUT', body: num(r) });
              toast('Курсы обновлены');
              setRates(null);
              void refetch();
            } catch (e) {
              setError(errorText(e));
            }
          }}>Сохранить курсы</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Стандартные комиссии" sub="Применяются ко всем магазинам без индивидуальных условий" />
        <div className="grid grid-cols-2 gap-3">
          {Object.keys(f).map((k) => (
            <Field key={k} label={`${METHOD_TITLE[k]}, %`}>
              <Input inputMode="decimal" value={f[k]} onChange={(e) => setFees({ ...f, [k]: e.target.value })} mono />
            </Field>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="primary" onClick={async () => {
            try {
              await api('/admin/fees', { method: 'PUT', body: num(f) });
              toast('Комиссии обновлены');
              setFees(null);
              void refetch();
            } catch (e) {
              setError(errorText(e));
            }
          }}>Сохранить комиссии</Button>
        </div>
      </Card>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}

function Cards() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ['admin-cards'], queryFn: () => api<{ items: { pan: string; outcome: string; label: string }[]; outcomes: Record<string, string> }>('/admin/cards') });
  const [adding, setAdding] = useState(false);
  const [pan, setPan] = useState('');
  const [outcome, setOutcome] = useState('success');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!data) return <Loading />;
  const brand = (p: string) => brandOf(p);
  return (
    <Card pad={false}>
      <div className="p-5 flex flex-wrap items-start justify-between gap-3">
        <CardHeader title="Карты банка-эмитента" sub="Только эти номера принимаются к оплате. Результат операции определяется номером карты." icon={<CreditCard className="size-4" />} />
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Добавить карту</Button>
      </div>
      <ul className="divide-y divide-line border-t border-line">
        {data.items.map((c) => {
          const b = brand(c.pan);
          return (
            <li key={c.pan} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              {b && b !== 'amex' && b !== 'jcb' && <PayLogo name={b} />}
              <span className="font-mono w-48">{c.pan.replace(/(\d{4})(?=\d)/g, '$1 ')}</span>
              <Badge tone={c.outcome === 'success' ? 'ok' : c.outcome === 'three_ds' ? 'info' : 'bad'}>{data.outcomes[c.outcome]}</Badge>
              <span className="flex-1 text-muted truncate hidden sm:block">{c.label}</span>
              <IconButton label="Удалить" onClick={async () => {
                if (!confirm(`Удалить карту ${c.pan}?`)) return;
                await api(`/admin/cards/${c.pan}`, { method: 'DELETE' });
                void qc.invalidateQueries({ queryKey: ['admin-cards'] });
              }}><Trash2 className="size-4" /></IconButton>
            </li>
          );
        })}
      </ul>
      <Modal open={adding} onClose={() => setAdding(false)} title="Новая карта" footer={<><Button onClick={() => setAdding(false)}>Отмена</Button><Button variant="primary" onClick={async () => {
        try {
          await api('/admin/cards', { body: { pan, outcome, label } });
          setAdding(false);
          setPan('');
          setLabel('');
          setError(null);
          void qc.invalidateQueries({ queryKey: ['admin-cards'] });
          toast('Карта добавлена');
        } catch (e) {
          setError(errorText(e));
        }
      }}>Добавить</Button></>}>
        <div className="flex flex-col gap-4">
          <Field label="Номер карты" hint="16 цифр, должен проходить проверку Луна"><Input value={pan} onChange={(e) => setPan(e.target.value.replace(/\D/g, '').slice(0, 16))} mono inputMode="numeric" /></Field>
          <Field label="Результат операции">
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {Object.entries(data.outcomes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Подпись"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Карта игрока Алексей" /></Field>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
      </Modal>
    </Card>
  );
}

function Audit() {
  const { data } = useQuery({ queryKey: ['admin-audit'], queryFn: () => api<{ items: { id: number; ts: number; user_email: string | null; action: string; entity: string | null; entity_id: string | null; summary: string | null; ip: string | null }[] }>('/admin/audit') });
  if (!data) return <Loading />;
  return (
    <Card pad={false}>
      <ul className="divide-y divide-line">
        {data.items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-5 py-2.5 text-sm">
            <span className="text-xs text-faint w-36">{dateTimeSec(a.ts)}</span>
            <Badge className="font-mono">{a.action}</Badge>
            <span className="text-muted">{a.user_email ?? '—'}</span>
            <span className="text-xs text-faint font-mono truncate flex-1 min-w-0">{[a.entity, a.entity_id, a.summary].filter(Boolean).join(' · ')}</span>
            <span className="text-xs text-faint">{a.ip}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
