import { Check, Crown, KeyRound, LogOut, Moon, Phone, Shield } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { InstallIcon, useInstall } from '../components/InstallApp';
import { Row, Screen } from '../components/Screen';
import { Badge, Button, Card, ErrorNote, Field, Input, Loading, Modal, Segmented, useToast } from '../components/ui';
import { getTheme, setTheme, type Theme } from '../lib/theme';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { longDate, money } from '../lib/format';
import { useHome, useMeta, useRefresh } from '../lib/hooks';
import { ConnectedServices } from './Connect';
import { GosProfileCard } from './GosPages';
import { SectionTitle } from './Shell';

export default function Profile() {
  const nav = useNavigate();
  const toast = useToast();
  const refresh = useRefresh();
  const { logout, user } = useAuth();
  const { data } = useHome();
  const { data: meta } = useMeta();
  const [pw, setPw] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [busy, setBusy] = useState(false);
  const install = useInstall();
  if (!data) return <Loading />;
  const p = data.profile;
  const prime = p.tariff === 'prime';
  const setTariff = async (t: 'prime' | 'standard') => {
    setBusy(true);
    try {
      await api('/tariff', { body: { tariff: t } });
      toast(t === 'prime' ? 'Bobo Prime подключён' : 'Подписка отключена');
      refresh();
    } catch (e) {
      toast(errorText(e), 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title="Профиль">
      <Card className="flex items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-brand text-2xl font-semibold text-on-brand">{p.name[0]}</span>
        <div className="min-w-0">
          <div className="truncate text-xl font-semibold">{p.name}</div>
          <div className="text-sm text-muted num">{p.phoneFormatted}</div>
          {p.telecomPhone && <div className="text-sm text-muted num">Бобтелеком: {p.telecomPhone}</div>}
          <div className="mt-1 text-xs text-faint">Клиент с {longDate(p.createdAt)}</div>
        </div>
      </Card>

      <SectionTitle>Тариф</SectionTitle>
      <Card id="prime" className={prime ? '!bg-[#2B2A28] !text-[#E7C987]' : ''}>
        <div className="flex items-center gap-3">
          <Crown className="size-7" />
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold">Bobo Prime</div>
            <div className="text-sm opacity-80">{prime ? `Подключён${p.tariffPaidUntil ? ` · оплачен до ${longDate(p.tariffPaidUntil)}` : ''}` : `${money(39_900)} в месяц`}</div>
          </div>
          {prime && <Badge tone="brand" icon={<Check className="size-3" />}>Активен</Badge>}
        </div>
        <ul className="mt-3 space-y-1 text-sm opacity-90">
          <li>• Кешбэк 1,5% на всё и 7% в трёх категориях</li>
          <li>• Переводы без комиссии до 1 млн ₽ в месяц</li>
          <li>• Карта Prime в золотом дизайне</li>
        </ul>
        <Button className="mt-4 w-full" variant={prime ? 'secondary' : 'primary'} loading={busy} onClick={() => void setTariff(prime ? 'standard' : 'prime')}>{prime ? 'Отключить подписку' : 'Подключить за 399 ₽'}</Button>
      </Card>

      <GosProfileCard gos={p.gos} />

      <ConnectedServices />

      <SectionTitle>Оформление</SectionTitle>
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="inline-flex items-center gap-2 font-medium"><Moon className="size-5 text-brand" />Тема</span>
        <Segmented value={theme} onChange={(t) => (setThemeState(t), setTheme(t))} options={[{ value: 'system', label: 'Как в системе' }, { value: 'light', label: 'Светлая' }, { value: 'dark', label: 'Тёмная' }]} />
      </Card>
      {install.kind && (
        <Card pad={false} className="mt-3 overflow-hidden">
          <Row icon={<InstallIcon className="size-5 text-brand" />} title="Приложение на экране «Домой»" sub={install.kind === 'ios' ? 'Добавить иконку Bobobank на iPhone' : 'Установить Bobobank на телефон'} onClick={install.start} />
        </Card>
      )}
      {install.sheet}

      <SectionTitle>Безопасность</SectionTitle>
      <Card pad={false} className="divide-y divide-line overflow-hidden">
        <Row icon={<KeyRound className="size-5 text-brand" />} title="Сменить пароль" onClick={() => setPw(true)} />
        {(user?.role === 'admin' || user?.role === 'support') && <Row icon={<Shield className="size-5 text-brand" />} title={user.role === 'admin' ? 'Админка банка' : 'Рабочее место поддержки'} onClick={() => nav('/admin')} />}
        <Row icon={<Phone className="size-5 text-brand" />} title="Позвонить в банк" sub={`${meta?.bank.phone ?? '900'} — бесплатно по России`} />
        <Row icon={<LogOut className="size-5 text-bad" />} title="Выйти" danger onClick={() => void logout().then(() => nav('/'))} />
      </Card>
      {meta && <p className="mt-6 text-center text-xs text-faint">{meta.bank.legalName} · БИК {meta.bank.bik} · ИНН {meta.bank.inn}<br />{meta.bank.address}</p>}
      <PasswordModal open={pw} onClose={() => setPw(false)} />
    </Screen>
  );
}

function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Modal open={open} onClose={onClose} title="Новый пароль" size="sm" footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" loading={busy} onClick={() => {
      setBusy(true);
      setErr(null);
      api('/profile/password', { body: { currentPassword: cur, newPassword: next } }).then(() => { toast('Пароль изменён'); onClose(); }, (e) => setErr(errorText(e))).finally(() => setBusy(false));
    }}>Сохранить</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Текущий пароль"><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="Новый пароль" hint="Не короче 8 символов"><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        {err && <ErrorNote>{err}</ErrorNote>}
      </div>
    </Modal>
  );
}
