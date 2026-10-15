import { useQueryClient } from '@tanstack/react-query';
import { CreditCard, Dices, Store } from 'lucide-react';
import { BoboMark } from '../checkout/AsyncMethods';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShopAvatar } from '../checkout/Checkout';
import type { MethodType } from '../checkout/types';
import { Logo } from '../components/Logo';
import { CardLogos, SbpMark } from '../components/PaymentLogos';
import { Button, Card, CardHeader, cx, ErrorNote, Field, Input, PageHeader, Select, Toggle, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useShop } from './Layout';
import { TAX_SYSTEMS, VAT_LABEL, type PayoutAccount, type Shop } from './types';

const COLORS = ['#5b3df5', '#0f766e', '#c2410c', '#be123c', '#1d4ed8', '#7c3aed', '#15803d', '#0b0b14'];

interface ShopFields {
  name: string;
  legalName: string;
  inn: string;
  taxSystem: string;
  site: string;
  color: string;
}

function ShopFieldsForm({ v, set }: { v: ShopFields; set: (p: Partial<ShopFields>) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Название магазина" hint="Его увидят покупатели на странице оплаты">
        <Input value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="Кофейня «Зерно»" maxLength={60} />
      </Field>
      <Field label="Сайт" hint="Будет указан в чеке как место расчётов">
        <Input value={v.site} onChange={(e) => set({ site: e.target.value })} placeholder="zerno-coffee.ru" />
      </Field>
      <Field label="Юридическое название">
        <Input value={v.legalName} onChange={(e) => set({ legalName: e.target.value })} placeholder="ООО «Зерно и Ко» / ИП Иванов И. И." />
      </Field>
      <Field
        label="ИНН"
        aside={
          <button type="button" className="inline-flex items-center gap-1 text-xs text-brand" onClick={async () => set({ inn: (await api<{ newInn: string }>('/m/meta')).newInn })}>
            <Dices className="size-3.5" /> Сгенерировать
          </button>
        }
      >
        <Input value={v.inn} onChange={(e) => set({ inn: e.target.value.replace(/\D/g, '').slice(0, 12) })} placeholder="10 или 12 цифр" inputMode="numeric" mono />
      </Field>
      <Field label="Система налогообложения">
        <Select value={v.taxSystem} onChange={(e) => set({ taxSystem: e.target.value })}>
          {Object.entries(TAX_SYSTEMS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </Select>
      </Field>
      <Field label="Цвет бренда">
        <div className="flex items-center gap-2 h-10">
          {COLORS.map((c) => (
            <button key={c} type="button" aria-label={c} onClick={() => set({ color: c })} className={cx('size-7 rounded-full transition-transform', v.color === c ? 'ring-2 ring-offset-2 ring-offset-surface ring-[var(--c)] scale-110' : 'hover:scale-110')} style={{ background: c, ['--c' as string]: c }} />
          ))}
        </div>
      </Field>
    </div>
  );
}

export function NewShop() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [v, setV] = useState<ShopFields>({ name: '', legalName: '', inn: '', taxSystem: 'usn_income', site: '', color: COLORS[0] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = !qc.getQueryData<Shop[]>(['shops'])?.length;
  return (
    <div className="min-h-screen px-4 py-10 flex flex-col items-center">
      <Link to="/app"><Logo /></Link>
      <Card className="mt-8 w-full max-w-2xl !p-7">
        <div className="flex items-center gap-4 mb-6">
          <ShopAvatar shop={{ name: v.name || 'М', color: v.color }} className="size-12 text-lg" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{first ? `${user?.name.split(' ')[0] ?? 'Здравствуйте'}, подключим ваш магазин` : 'Новый магазин'}</h1>
            <p className="text-sm text-muted">Анкета для договора эквайринга. Проверка занимает пару секунд.</p>
          </div>
        </div>
        <ShopFieldsForm v={v} set={(p) => setV({ ...v, ...p })} />
        {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}
        <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-faint max-w-sm">Нажимая кнопку, вы принимаете оферту GPAY на эквайринговое обслуживание и тарифы.</p>
          <Button
            variant="primary"
            size="lg"
            loading={busy}
            icon={<Store className="size-4" />}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const r = await api<{ shop: Shop }>('/m/shops', { body: v });
                qc.setQueryData<Shop[]>(['shops'], (old) => [...(old ?? []), r.shop]);
                navigate(`/app/${r.shop.id}`);
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Подключить магазин
          </Button>
        </div>
      </Card>
    </div>
  );
}

const METHOD_ROWS: { type: MethodType; title: string; sub: string; icon: ReactNode }[] = [
  { type: 'bank_card', title: 'Карты Bobobank', sub: 'МИР, Visa, Mastercard, UnionPay · подтверждение в приложении банка', icon: <CreditCard className="size-5" /> },
  { type: 'sbp', title: 'СБП', sub: 'QR-код открывает заказ в приложении Bobobank', icon: <SbpMark className="size-5" /> },
  { type: 'bobopay', title: 'Bobo Pay', sub: 'Кнопка оплаты в Bobobank или запрос по номеру телефона', icon: <BoboMark className="size-5" /> },
];

export default function Settings() {
  const shop = useShop();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState<ShopFields>({ name: shop.name, legalName: shop.legalName, inn: shop.inn, taxSystem: shop.taxSystem, site: shop.site, color: shop.color });
  const [methods, setMethods] = useState(shop.methods);
  const [returnUrl, setReturnUrl] = useState(shop.returnUrl);
  const [defaultVat, setDefaultVat] = useState(shop.defaultVat);
  const [mcc, setMcc] = useState(shop.mcc ?? 5999);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (part: string, body: object) => {
    setBusy(part);
    setError(null);
    try {
      await api(`/m/shops/${shop.id}`, { method: 'PATCH', body });
      await qc.invalidateQueries({ queryKey: ['shops'] });
      toast('Сохранено');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <PageHeader title="Настройки" sub={`Магазин ${shop.id}`} />
      {error && <ErrorNote>{error}</ErrorNote>}
      <Card>
        <CardHeader title="Реквизиты" sub="Используются на странице оплаты и в кассовых чеках" />
        <ShopFieldsForm v={v} set={(p) => setV({ ...v, ...p })} />
        <div className="mt-5 flex justify-end"><Button variant="primary" loading={busy === 'info'} onClick={() => save('info', v)}>Сохранить</Button></div>
      </Card>
      <Card>
        <CardHeader title="Способы оплаты" sub="Что увидит покупатель на странице оплаты" />
        <ul className="flex flex-col divide-y divide-line">
          {METHOD_ROWS.map((m) => (
            <li key={m.type} className="flex items-center gap-4 py-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-sunken text-brand">{m.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium">{m.title}</span>
                <span className="block text-xs text-muted">{m.sub} · комиссия {shop.fees[m.type].toLocaleString('ru-RU')}%</span>
                {m.type === 'bank_card' && <CardLogos className="mt-1.5" />}
              </span>
              <Toggle checked={methods.includes(m.type)} onChange={(on) => setMethods(on ? [...methods, m.type] : methods.filter((x) => x !== m.type))} />
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-end"><Button variant="primary" loading={busy === 'methods'} onClick={() => save('methods', { methods })}>Сохранить</Button></div>
      </Card>
      <Card>
        <CardHeader title="Платежи и чеки" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="URL возврата по умолчанию" hint="Куда вернуть покупателя после оплаты, если не передан return_url">
            <Input value={returnUrl} onChange={(e) => setReturnUrl(e.target.value)} placeholder="https://example.com/thanks" />
          </Field>
          <Field label="Категория магазина (MCC)" hint="Видна в выписке покупателя и влияет на его кешбэк">
            <Select value={mcc} onChange={(e) => setMcc(Number(e.target.value))}>
              {MCC.map(([code, t]) => <option key={code} value={code}>{code} · {t}</option>)}
            </Select>
          </Field>
          <Field label="НДС по умолчанию" hint="Для платежей без переданного чека">
            <Select value={defaultVat} onChange={(e) => setDefaultVat(e.target.value)}>
              {Object.entries(VAT_LABEL).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </Select>
          </Field>
        </div>
        <dl className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl bg-sunken px-3.5 py-2.5"><dt className="text-xs text-muted">РН ККТ</dt><dd className="font-mono">{shop.kkt.rn}</dd></div>
          <div className="rounded-xl bg-sunken px-3.5 py-2.5"><dt className="text-xs text-muted">Фискальный накопитель</dt><dd className="font-mono">{shop.kkt.fn}</dd></div>
          <div className="rounded-xl bg-sunken px-3.5 py-2.5"><dt className="text-xs text-muted">Чеков пробито</dt><dd className="font-mono">{shop.kkt.fd}</dd></div>
        </dl>
        <div className="mt-5 flex justify-end"><Button variant="primary" loading={busy === 'pay'} onClick={() => save('pay', { returnUrl, defaultVat, mcc })}>Сохранить</Button></div>
      </Card>
      {shop.bankEnabled && <BankPayouts shopId={shop.id} account={shop.payoutAccount} />}
      <Profile />
    </div>
  );
}

const MCC: [number, string][] = [
  [5999, 'Прочие розничные магазины'], [5411, 'Супермаркеты'], [5814, 'Фастфуд и кофейни'], [5812, 'Рестораны'], [5651, 'Одежда'], [5732, 'Электроника'],
  [5816, 'Цифровые игры'], [5815, 'Цифровые товары, подписки'], [7832, 'Кинотеатры'], [7999, 'Развлечения'], [4121, 'Такси'], [4111, 'Транспорт'], [5541, 'АЗС'],
  [5912, 'Аптеки'], [7230, 'Салоны красоты'], [5200, 'Товары для дома'], [7011, 'Отели'], [4511, 'Авиабилеты'], [8299, 'Образование'], [4814, 'Связь'], [7399, 'Услуги для бизнеса'],
];

/** Payouts of Bobobank money: the shop owner enters a one-time code from the bank app. */
function BankPayouts({ shopId, account }: { shopId: number; account: PayoutAccount | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['shops'] });
      toast(ok);
      setCode('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Выплаты в Bobobank" sub="Деньги, которые покупатели заплатили картами Bobobank и через СБП, выводятся на счёт в Bobobank" />
      {account ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex-1 rounded-xl bg-sunken px-4 py-3 text-sm">
            <div className="font-medium">{account.holder}</div>
            <div className="text-muted tabular-nums">Счёт {account.number} · {account.currency}</div>
          </div>
          <Button loading={busy} onClick={() => void run(() => api(`/m/shops/${shopId}/bank-link`, { method: 'DELETE' }), 'Счёт отключён')}>Отключить</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ol className="list-decimal pl-5 text-sm text-muted space-y-1">
            <li>Откройте приложение Bobobank → нужный счёт (бизнес или платёжный).</li>
            <li>Нажмите «Подключить магазин GPAY» — появится код из 8 цифр.</li>
            <li>Введите код здесь.</li>
          </ol>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d-]/g, '').slice(0, 9))} placeholder="1234-5678" className="sm:max-w-[200px] tabular-nums" />
            <Button variant="primary" loading={busy} disabled={code.replace(/\D/g, '').length !== 8} onClick={() => void run(() => api(`/m/shops/${shopId}/bank-link`, { body: { code } }), 'Счёт Bobobank подключён')}>Подключить</Button>
          </div>
        </div>
      )}
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
    </Card>
  );
}

function Profile() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Профиль" sub={user?.email} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Field label="Имя"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Текущий пароль"><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="Новый пароль" hint="Не короче 8 символов"><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      </div>
      {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}
      <div className="mt-5 flex justify-end">
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const r = await api<{ user: typeof user }>('/auth/profile', { body: { name, currentPassword: cur || undefined, newPassword: next || undefined } });
              setUser(r.user);
              setCur('');
              setNext('');
              toast('Профиль обновлён');
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Сохранить
        </Button>
      </div>
    </Card>
  );
}
