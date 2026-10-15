import { useQuery } from '@tanstack/react-query';
import { Ban, Copy, Eye, EyeOff, Globe, RefreshCw, ShieldCheck, Snowflake, Wallet } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BankCard } from '../components/BankCard';
import { EntryRow } from '../components/EntryRow';
import { Row, Screen } from '../components/Screen';
import { Badge, Button, Card, ErrorNote, Field, Input, Loading, Modal, Toggle, cx, useCopy, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { money, toAmount } from '../lib/format';
import { useRefresh } from '../lib/hooks';
import type { Account, Card as CardT, Entry } from '../lib/types';
import { SectionTitle } from './Shell';

export default function CardPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const refresh = useRefresh();
  const { copy } = useCopy();
  const { data, error, refetch } = useQuery({ queryKey: ['card', id], queryFn: () => api<{ card: CardT; account: Account; entries: Entry[] }>(`/cards/${id}`) });
  const [details, setDetails] = useState<{ pan: string; cvc: string } | null>(null);
  const [limitOpen, setLimitOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorNote>{errorText(error)}</ErrorNote>;
  if (!data) return <Loading />;
  const { card, account } = data;

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok);
      await refetch();
      refresh();
    } catch (e) {
      toast(errorText(e), 'bad');
    } finally {
      setBusy(false);
    }
  };
  const reveal = async () => {
    if (details) return setDetails(null);
    try {
      setDetails(await api<{ pan: string; cvc: string }>(`/cards/${id}/reveal`, { body: {} }));
      setTimeout(() => setDetails(null), 60_000);
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  };
  const blocked = card.status === 'blocked';

  return (
    <Screen title={`${card.networkTitle} •• ${card.last4}`} sub={`${card.tariffTitle} · ${card.form === 'virtual' ? 'виртуальная' : 'пластиковая'}`}>
      <div className="flex flex-col items-center">
        <BankCard card={card} size="lg" number={details?.pan} cvc={details?.cvc} />
        <div className="mt-4 text-center">
          <div className="text-sm text-muted">{card.kind === 'credit' ? 'Доступно с учётом лимита' : 'Доступно'}</div>
          <div className="text-[30px] font-semibold num">{money(account.available, account.currency, { exact: account.available % 100 !== 0 })}</div>
          {account.held > 0 && <div className="text-sm text-warn">Ожидает списания {money(account.held, account.currency)}</div>}
        </div>
      </div>

      {blocked && <div className="mt-5"><ErrorNote>Карта заблокирована банком{card.statusReason ? `: ${card.statusReason}` : ''}. Напишите в чат поддержки.</ErrorNote></div>}

      <div className="mt-6 grid grid-cols-3 gap-2">
        <Tile icon={details ? <EyeOff className="size-5" /> : <Eye className="size-5" />} label={details ? 'Скрыть' : 'Реквизиты'} onClick={() => void reveal()} />
        <Tile icon={<Snowflake className="size-5" />} label={card.status === 'frozen' ? 'Разморозить' : 'Заморозить'} active={card.status === 'frozen'} disabled={blocked || busy} onClick={() => void act(() => api(`/cards/${id}/freeze`, { body: { frozen: card.status !== 'frozen' } }), card.status === 'frozen' ? 'Карта снова работает' : 'Карта заморожена')} />
        <Tile icon={<Wallet className="size-5" />} label="Пополнить" onClick={() => nav(`/app/transfer/own?to=${account.id}`)} />
      </div>

      {details && (
        <Card className="mt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[['Номер', details.pan.replace(/(\d{4})(?=\d)/g, '$1 ')], ['Срок', card.exp], ['CVC', details.cvc]].map(([k, v]) => (
              <button key={k} type="button" onClick={() => { copy(v.replace(/\s/g, '')); toast(`${k} скопирован`); }} className="flex items-center justify-between gap-2 rounded-2xl bg-sunken px-4 py-3 text-left">
                <span><span className="block text-xs text-muted">{k}</span><span className="font-semibold num">{v}</span></span>
                <Copy className="size-4 text-muted" />
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">Реквизиты скроются через минуту. Никому не сообщайте CVC — сотрудники банка его не спрашивают.</p>
        </Card>
      )}

      <SectionTitle>Настройки</SectionTitle>
      <Card pad={false} className="divide-y divide-line overflow-hidden">
        <Row icon={<ShieldCheck className="size-5 text-brand" />} title="Подтверждать покупки в приложении" sub="Покупка в интернете ждёт вашего «Подтвердить»" right={<Toggle checked={card.confirmPurchases} disabled={busy} onChange={(v) => void act(() => api(`/cards/${id}/settings`, { body: { confirmPurchases: v } }))} />} />
        <Row icon={<Globe className="size-5 text-brand" />} title="Оплата в интернете" sub={card.limits.online ? 'Включена' : 'Выключена'} right={<Toggle checked={card.limits.online} disabled={busy} onChange={(v) => void act(() => api(`/cards/${id}/settings`, { body: { online: v } }))} />} />
        <Row icon={<Wallet className="size-5 text-brand" />} title="Лимит покупок в месяц" sub={card.limits.monthly ? money(card.limits.monthly) : 'Без лимита'} onClick={() => setLimitOpen(true)} right={<span className="text-sm font-semibold text-brand">Изменить</span>} />
        <Row icon={<RefreshCw className="size-5 text-brand" />} title="Перевыпустить карту" sub="Новый номер, старая карта закроется" onClick={() => void act(async () => { const r = await api<{ card: CardT }>(`/cards/${id}/reissue`, { body: {} }); nav(`/app/cards/${r.card.id}`, { replace: true }); }, 'Карта перевыпущена')} />
        <Row icon={<Ban className="size-5 text-bad" />} title="Закрыть карту" danger onClick={() => setConfirmClose(true)} />
      </Card>

      <div className="mt-4 flex flex-wrap gap-2 text-sm text-muted">
        <Badge>{card.kind === 'credit' ? 'Кредитная' : 'Дебетовая'}</Badge>
        <Badge>Счёт •• {card.accountNumber?.slice(-4)}</Badge>
        <Badge tone={card.status === 'active' ? 'brand' : 'warn'}>{card.status === 'active' ? 'Активна' : card.status === 'frozen' ? 'Заморожена' : 'Заблокирована'}</Badge>
      </div>

      <SectionTitle>Операции по карте</SectionTitle>
      <Card pad={false} className="overflow-hidden">
        {data.entries.length ? data.entries.map((e) => <EntryRow key={e.id} e={e} />) : <div className="px-5 py-8 text-center text-sm text-muted">Покупок по карте ещё не было</div>}
      </Card>

      <LimitModal open={limitOpen} onClose={() => setLimitOpen(false)} current={card.limits.monthly} onSave={(v) => act(() => api(`/cards/${id}/settings`, { body: { monthly: v } }), 'Лимит сохранён')} />
      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} title="Закрыть карту?" size="sm" footer={<><Button onClick={() => setConfirmClose(false)}>Отмена</Button><Button variant="danger" loading={busy} onClick={() => void act(async () => { await api(`/cards/${id}/close`, { body: {} }); nav('/app', { replace: true }); }, 'Карта закрыта')}>Закрыть</Button></>}>
        <p className="text-sm text-muted">Карта перестанет работать сразу. Деньги останутся на счёте •• {card.accountNumber?.slice(-4)}.</p>
      </Modal>
    </Screen>
  );
}

function Tile({ icon, label, onClick, active, disabled }: { icon: ReactNode; label: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cx('flex flex-col items-center gap-1.5 rounded-[20px] py-3.5 text-[13px] font-semibold shadow-card transition-colors disabled:opacity-50', active ? 'bg-info-soft text-info' : 'bg-surface hover:bg-sunken')}>
      {icon}
      {label}
    </button>
  );
}

function LimitModal({ open, onClose, current, onSave }: { open: boolean; onClose: () => void; current: number; onSave: (v: number) => Promise<void> }) {
  const [v, setV] = useState(current ? String(current / 100) : '');
  return (
    <Modal open={open} onClose={onClose} title="Лимит покупок" size="sm" footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={() => { const a = v ? toAmount(v) : '0'; void onSave(a ? Math.round(Number(a) * 100) : 0).then(onClose); }}>Сохранить</Button></>}>
      <Field label="В месяц, ₽" hint="Оставьте пустым — без лимита">
        <Input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} placeholder="Без лимита" />
      </Field>
    </Modal>
  );
}
