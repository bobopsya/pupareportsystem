import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ChevronRight, ExternalLink, Landmark, LogOut, QrCode, Shield, Trash2, Wifi } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { EsimModal } from '../components/Line';
import { Card, Shell } from '../components/Shell';
import { Button, cx, Modal, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { day, rub } from '../lib/format';
import { useAccount, useLine, useMe } from '../lib/hooks';
import { applyTheme, getTheme, setTheme, type Theme } from '../lib/theme';
import { login } from './Home';

export default function Profile() {
  const me = useMe();
  const user = me.data?.user;
  const account = useAccount(!!user?.linked);
  const line = useLine(!!user);
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [theme, setT] = useState<Theme>(getTheme());
  const [esim, setEsim] = useState(false);
  const [closing, setClosing] = useState(false);
  const [params, setParams] = useSearchParams();
  // Links are synced in the background: show the latest state when the page opens.
  useEffect(() => void qc.invalidateQueries({ queryKey: ['me'] }), [qc]);
  useEffect(() => {
    const err = params.get('gos_error');
    if (err) toast(err, 'bad');
    if (params.get('gos') === 'linked') toast('Номер подтверждён через Бобуслуги');
    if (err || params.get('gos')) setParams({}, { replace: true });
  }, [params, setParams, toast]);
  const unlink = useMutation({
    mutationFn: () => api('/gos/unlink', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me'] }),
    onError: (e) => toast(errorText(e), 'bad'),
  });
  const logout = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      qc.clear();
      nav('/');
    },
  });
  const close = useMutation({
    mutationFn: () => api('/line/close', { method: 'POST' }),
    onSuccess: () => {
      toast('Договор расторгнут, номер освобождён');
      setClosing(false);
      void qc.invalidateQueries({ queryKey: ['line'] });
      nav('/connect');
    },
    onError: (e) => toast(errorText(e), 'bad'),
  });
  if (me.data && !user) return <Navigate to="/" replace />;
  if (!user) return null;
  const l = line.data?.line;
  const a = account.data;
  return (
    <Shell title="Профиль">
      <Card>
        <p className="text-[20px] font-bold">{user.name}</p>
        {l && <p className="mt-0.5 text-[15px] text-muted num">{l.formatted} · с {day(l.createdAt)}</p>}
      </Card>

      <h2 className="mb-2 mt-6 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">Оплата</h2>
      <Card>
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-[#21a038] text-sm font-bold text-white">B</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">{user.linked ? `Bobobank •• ${user.accountLast4}` : 'Счёт не привязан'}</span>
            <span className="block text-sm text-muted">{a?.linked ? (a.unavailable ? 'Банк не отвечает' : `Доступно ${rub(a.available ?? 0)} · лимит списания ${rub(a.limit ?? 0)}`) : 'Абонплата спишется после привязки'}</span>
          </span>
        </div>
        <div className="mt-3 flex gap-2">
          {!user.linked && (
            <Button size="sm" variant="brand" onClick={login}>
              Привязать
            </Button>
          )}
          {me.data?.bankUrl && (
            <a href={`${me.data.bankUrl}/app/profile`} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-sunken px-3.5 text-sm font-semibold hover:bg-hover">
              Открыть Bobobank <ExternalLink className="size-4" />
            </a>
          )}
        </div>
      </Card>

      {l && (
        <>
          <h2 className="mb-2 mt-6 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">Привязки номера</h2>
          <div className="flex flex-col gap-2">
            <Card>
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#21a038] text-sm font-bold text-white">B</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">Bobobank</span>
                  <span className="block text-sm text-muted">
                    {user.bankPhone === l.number ? `Переводы по номеру ${l.formatted} приходят на счёт •• ${user.accountLast4}` : user.linked ? 'Сообщаем номер банку…' : 'Привяжите счёт, чтобы получать переводы по номеру'}
                  </span>
                </span>
                {user.bankPhone === l.number && <BadgeCheck className="size-5 shrink-0 text-ok" />}
              </div>
            </Card>
            <Card>
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#1d4ed8] text-white">
                  <Landmark className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">Бобуслуги</span>
                  {user.gos ? (
                    <span className="block text-sm text-muted">
                      Номер оформлен на {user.gos.name}
                      {user.gos.passport ? `, паспорт ${user.gos.passport}` : ''} · @{user.gos.login}
                      {user.gos.phone === l.number ? ' · виден в кабинете' : ''}
                    </span>
                  ) : (
                    <span className="block text-sm text-muted">Оформите номер на свой Бобопаспорт — он появится в кабинете Бобуслуг.</span>
                  )}
                </span>
                {user.gos && <BadgeCheck className="size-5 shrink-0 text-ok" />}
              </div>
              {user.gos ? (
                <Button className="mt-3" size="sm" loading={unlink.isPending} onClick={() => unlink.mutate()}>
                  Отвязать
                </Button>
              ) : me.data?.gosEnabled ? (
                <a href="/api/auth/gos/start" className="mt-3 inline-flex h-9 items-center rounded-xl bg-[#1d4ed8] px-3.5 text-sm font-semibold text-white hover:brightness-110">
                  Подтвердить через Бобуслуги
                </a>
              ) : (
                <p className="mt-2 text-xs text-faint">Бобуслуги пока не подключены к Бобтелекому на этом сервере.</p>
              )}
            </Card>
          </div>
        </>
      )}

      <h2 className="mb-2 mt-6 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">Оформление</h2>
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-sunken p-1">
        {([['system', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => (setTheme(k), applyTheme(k), setT(k))} className={cx('h-10 rounded-xl text-sm font-semibold', theme === k ? 'bg-surface shadow-sm' : 'text-muted')}>
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 flex flex-col overflow-hidden rounded-3xl bg-surface ring-1 ring-line">
        {l && (
          <button type="button" onClick={() => setEsim(true)} className="flex items-center gap-3 px-4 py-3.5 text-left hover:bg-sunken">
            <QrCode className="size-5 text-brand-text" />
            <span className="flex-1 text-[15px] font-medium">eSIM</span>
            <ChevronRight className="size-5 text-muted" />
          </button>
        )}
        <Link to="/internet" className="flex items-center gap-3 border-t border-line px-4 py-3.5 hover:bg-sunken">
          <Wifi className="size-5 text-brand-text" />
          <span className="flex-1 text-[15px] font-medium">Домашний интернет</span>
          <ChevronRight className="size-5 text-muted" />
        </Link>
        {user.role === 'admin' && (
          <Link to="/admin" className="flex items-center gap-3 border-t border-line px-4 py-3.5 hover:bg-sunken">
            <Shield className="size-5 text-brand-text" />
            <span className="flex-1 text-[15px] font-medium">Админка</span>
            <ChevronRight className="size-5 text-muted" />
          </Link>
        )}
        <button type="button" onClick={() => logout.mutate()} className="flex items-center gap-3 border-t border-line px-4 py-3.5 text-left hover:bg-sunken">
          <LogOut className="size-5 text-muted" />
          <span className="flex-1 text-[15px] font-medium">Выйти</span>
        </button>
        {l && (
          <button type="button" onClick={() => setClosing(true)} className="flex items-center gap-3 border-t border-line px-4 py-3.5 text-left text-bad hover:bg-sunken">
            <Trash2 className="size-5" />
            <span className="flex-1 text-[15px] font-medium">Расторгнуть договор</span>
          </button>
        )}
      </div>
      {l && <EsimModal line={l} open={esim} onClose={() => setEsim(false)} />}
      <Modal
        open={closing}
        onClose={() => setClosing(false)}
        title="Расторгнуть договор?"
        footer={
          <Button variant="danger" size="lg" loading={close.isPending} onClick={() => close.mutate()}>
            Да, отказаться от номера
          </Button>
        }
      >
        <p className="text-[15px]">Номер {l?.formatted} освободится и достанется кому-то другому. Оплаченный период не возвращается.</p>
      </Modal>
    </Shell>
  );
}
