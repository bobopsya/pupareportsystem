import { useQueryClient } from '@tanstack/react-query';
import { Briefcase, ChevronRight, Home as HomeIcon, LogOut, Moon, Plus, Share, Smartphone, Star, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, Section } from '../components/Page';
import { PlaceSearch } from '../components/Search';
import { Button, cx, Loading, Modal, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { rub } from '../lib/format';
import { useAccount, useMe, usePlaces } from '../lib/hooks';
import { canPrompt, isIOS, isStandalone, onInstallChange, promptInstall } from '../lib/install';
import { getTheme, setTheme, type Theme } from '../lib/theme';
import type { Place, SavedPlace } from '../lib/types';

const login = () => window.location.assign('/api/auth/bank/start');

function useInstallKind() {
  const [, render] = useState(0);
  useEffect(() => onInstallChange(() => render((n) => n + 1)), []);
  if (isStandalone()) return null;
  if (isIOS()) return 'ios' as const;
  return canPrompt() ? ('prompt' as const) : null;
}

export default function Profile() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const u = me?.user;
  const { data: account } = useAccount(!!u?.linked);
  const { data: places } = usePlaces(!!u);
  const [adding, setAdding] = useState<null | { kind: SavedPlace['kind']; title: string }>(null);
  const [favName, setFavName] = useState<Place | null>(null);
  const [favTitle, setFavTitle] = useState('');
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [iosHelp, setIosHelp] = useState(false);
  const install = useInstallKind();

  if (!me) return <Page title="Профиль"><Loading /></Page>;
  if (!u) {
    return (
      <Page title="Профиль">
        <p className="text-[15px] text-muted">Войдите через Bobobank: имя возьмём из банка, а оплата поездок будет списываться с выбранного счёта.</p>
        <Button className="mt-4 w-full" size="lg" variant="ink" onClick={login}>Войти через Bobobank</Button>
      </Page>
    );
  }
  const save = async (kind: SavedPlace['kind'], title: string, p: Place) => {
    try {
      await api('/places', { body: { kind, title, address: p.title, lat: p.lat, lon: p.lon } });
      void qc.invalidateQueries({ queryKey: ['places'] });
      toast('Адрес сохранён');
    } catch (e) {
      toast(errorText(e), 'bad');
    }
  };
  const remove = async (id: string) => {
    await api(`/places/${id}`, { method: 'DELETE' });
    void qc.invalidateQueries({ queryKey: ['places'] });
  };
  const saved = places?.places ?? [];
  const slot = (kind: 'home' | 'work', title: string, Icon: typeof HomeIcon) => {
    const p = saved.find((x) => x.kind === kind);
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <Icon className="size-5 shrink-0" />
        <button type="button" onClick={() => setAdding({ kind, title })} className="min-w-0 flex-1 text-left">
          <span className="block text-[15px] font-medium">{title}</span>
          <span className="block truncate text-sm text-muted">{p ? p.address : 'Добавить адрес'}</span>
        </button>
        {p ? (
          <button type="button" aria-label="Удалить" onClick={() => void remove(p.id)} className="text-muted hover:text-bad"><Trash2 className="size-4" /></button>
        ) : (
          <ChevronRight className="size-4 text-muted" />
        )}
      </div>
    );
  };

  return (
    <Page title="Профиль">
      <div className="flex items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-brand text-2xl font-bold text-on-brand">{u.name[0]}</span>
        <div className="min-w-0">
          <div className="truncate text-xl font-bold">{u.name}</div>
          <div className="text-sm text-muted">{u.phone}</div>
          <div className="mt-0.5 flex items-center gap-1 text-sm text-muted"><Star className="size-3.5 fill-current text-[#f5b400]" />{u.rating.toFixed(2).replace('.', ',')} — рейтинг пассажира</div>
        </div>
      </div>

      <Section title="Оплата">
        <div className="rounded-2xl bg-sunken p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-[#21a038] text-lg font-bold text-white">B</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{u.linked ? `Bobobank •• ${account?.accountLast4 ?? u.accountLast4 ?? ''}` : 'Счёт не привязан'}</div>
              <div className="text-sm text-muted">
                {!u.linked ? 'Привяжите счёт, чтобы ездить' : account?.unavailable ? 'Банк сейчас не отвечает' : account?.available !== undefined ? `Доступно ${rub(account.available)} · до ${rub(account.limit ?? 0)} за поездку` : '…'}
              </div>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted">Когда вы вызываете машину, банк замораживает сумму с запасом 20%. После поездки списывается точная цена, остальное размораживается. Отменили заказ до приезда машины — разморозим всё.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant={u.linked ? 'soft' : 'ink'} onClick={login}>{u.linked ? 'Сменить счёт' : 'Привязать'}</Button>
            {me.bankUrl && <a href={`${me.bankUrl}/app/profile`}><Button className="w-full">В Bobobank</Button></a>}
          </div>
        </div>
      </Section>

      <Section title="Мои адреса">
        <div className="divide-y divide-line overflow-hidden rounded-2xl bg-sunken">
          {slot('home', 'Дом', HomeIcon)}
          {slot('work', 'Работа', Briefcase)}
          {saved.filter((p) => p.kind === 'fav').map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3">
              <Star className="size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{p.title}</span>
                <span className="block truncate text-sm text-muted">{p.address}</span>
              </div>
              <button type="button" aria-label="Удалить" onClick={() => void remove(p.id)} className="text-muted hover:text-bad"><Trash2 className="size-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setAdding({ kind: 'fav', title: 'Избранный адрес' })} className="flex w-full items-center gap-3 px-4 py-3 text-left text-[15px] font-medium">
            <Plus className="size-5" />
            Добавить адрес
          </button>
        </div>
      </Section>

      <Section title="Оформление">
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-sunken p-2 pl-4">
          <span className="inline-flex items-center gap-2 font-medium"><Moon className="size-5" />Тема</span>
          <div className="flex rounded-xl bg-surface p-1">
            {(['system', 'light', 'dark'] as Theme[]).map((t) => (
              <button key={t} type="button" onClick={() => (setThemeState(t), setTheme(t))} className={cx('h-8 rounded-lg px-2.5 text-sm font-medium', theme === t ? 'bg-ink text-on-ink' : 'text-muted')}>
                {t === 'system' ? 'Авто' : t === 'light' ? 'Светлая' : 'Тёмная'}
              </button>
            ))}
          </div>
        </div>
        {install && (
          <button type="button" onClick={() => (install === 'prompt' ? void promptInstall() : setIosHelp(true))} className="mt-2 flex w-full items-center gap-3 rounded-2xl bg-sunken px-4 py-3 text-left">
            <Smartphone className="size-5" />
            <span className="flex-1">
              <span className="block font-medium">Приложение на экране «Домой»</span>
              <span className="block text-sm text-muted">Откроется на весь экран, как обычное приложение</span>
            </span>
          </button>
        )}
      </Section>

      <Button
        className="mt-8 w-full"
        variant="danger"
        icon={<LogOut className="size-5" />}
        onClick={() => void api('/auth/logout', { body: {} }).then(() => {
          qc.clear();
          nav('/');
          window.location.reload();
        })}
      >
        Выйти
      </Button>

      {adding && (
        <PlaceSearch
          title={adding.title}
          onClose={() => setAdding(null)}
          onPick={(p) => {
            const a = adding;
            setAdding(null);
            if (a.kind === 'fav') {
              setFavName(p);
              setFavTitle(p.title);
            } else void save(a.kind, a.title, p);
          }}
        />
      )}
      <Modal open={!!favName} onClose={() => setFavName(null)} title="Как назвать?" footer={<Button variant="ink" size="lg" disabled={!favTitle.trim()} onClick={() => { void save('fav', favTitle.trim(), favName!); setFavName(null); }}>Сохранить</Button>}>
        <input autoFocus value={favTitle} onChange={(e) => setFavTitle(e.target.value.slice(0, 60))} placeholder="Например: Спортзал" className="h-12 w-full rounded-2xl bg-sunken px-4 text-[16px] outline-none focus:ring-2 focus:ring-ink" />
      </Modal>
      <Modal open={iosHelp} onClose={() => setIosHelp(false)} title="На экран «Домой»" footer={<Button size="lg" onClick={() => setIosHelp(false)}>Понятно</Button>}>
        <ol className="flex flex-col gap-3 text-[15px]">
          <li>1. Откройте сайт в <b>Safari</b> и нажмите <Share className="mx-0.5 inline size-[18px] -translate-y-0.5 text-[#007AFF]" /> «Поделиться».</li>
          <li>2. Выберите «На экран „Домой“».</li>
          <li>3. Нажмите «Добавить» — иконка Бобо.Транспорта появится среди приложений.</li>
        </ol>
      </Modal>
    </Page>
  );
}
