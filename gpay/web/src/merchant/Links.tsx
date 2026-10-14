import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FileText, Link2, Plus, Printer, QrCode, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ShopAvatar } from '../checkout/Checkout';
import { Logo } from '../components/Logo';
import { CardLogos, PayLogo } from '../components/PaymentLogos';
import { QR } from '../components/QR';
import { Badge, Button, Card, CopyButton, cx, Empty, ErrorNote, Field, IconButton, Input, Loading, Modal, PageHeader, Segmented, Select, Textarea, Toggle, useToast } from '../components/ui';
import { api, errorText } from '../lib/api';
import { CURRENCY_SYMBOL, dateTime, longDate, money, toAmount } from '../lib/format';
import { useShop } from './Layout';
import { CurrencySelect } from './Pages';
import { VAT_LABEL } from './types';

interface LinkItem {
  id: string;
  type: 'link' | 'invoice';
  status: 'active' | 'paid' | 'expired' | 'disabled';
  url: string;
  slug: string;
  title: string;
  description?: string;
  amountMinor: number | null;
  currency: string;
  reusable: boolean;
  expires_at?: string;
  customer?: { email?: string; name?: string };
  stats: { opened: number; paid_count: number };
  paidTotal: number;
  createdAt: number;
}

const STATUS = {
  active: { label: 'Активна', tone: 'ok' as const },
  paid: { label: 'Оплачен', tone: 'brand' as const },
  expired: { label: 'Истекла', tone: 'neutral' as const },
  disabled: { label: 'Отключена', tone: 'neutral' as const },
};

export default function Links() {
  const shop = useShop();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['links', shop.id], queryFn: () => api<{ items: LinkItem[] }>(`/m/shops/${shop.id}/links`), refetchInterval: 15000 });
  const [create, setCreate] = useState<'link' | 'invoice' | null>(null);
  const [qr, setQr] = useState<LinkItem | null>(null);
  const toast = useToast();

  const toggle = async (l: LinkItem, active: boolean) => {
    await api(`/m/shops/${shop.id}/links/${l.id}`, { method: 'PATCH', body: { active } });
    void qc.invalidateQueries({ queryKey: ['links', shop.id] });
    toast(active ? 'Ссылка включена' : 'Ссылка отключена');
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Ссылки и счета"
        sub="Принимайте оплату без сайта: отправьте ссылку в мессенджер, по почте или распечатайте QR-код для кассы."
        actions={
          <>
            <Button icon={<FileText className="size-4" />} onClick={() => setCreate('invoice')}>Выставить счёт</Button>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreate('link')}>Новая ссылка</Button>
          </>
        }
      />
      {!data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <Card><Empty icon={<Link2 className="size-5" />} title="Ссылок пока нет" sub="Ссылка может быть с фиксированной суммой (товар, услуга) или со свободной — для донатов и чаевых." action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreate('link')}>Создать ссылку</Button>} /></Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {data.items.map((l) => (
            <Card key={l.id} className="flex flex-col !p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-lg', l.type === 'invoice' ? 'bg-info-soft text-info' : 'bg-sunken text-fg')}>
                    {l.type === 'invoice' ? <FileText className="size-4" /> : <Link2 className="size-4" />}
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{l.title}</div>
                    <div className="text-xs text-faint">{l.type === 'invoice' ? `Счёт${l.customer?.name ? ` · ${l.customer.name}` : ''}` : l.reusable ? 'Многоразовая' : 'Одноразовая'}</div>
                  </div>
                </div>
                <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge>
              </div>
              <div className="mt-3 text-xl font-semibold tracking-tight tabular-nums">{l.amountMinor ? money(l.amountMinor, l.currency, { exact: l.amountMinor % 100 !== 0 }) : <span className="text-muted text-base font-medium">Свободная сумма, {CURRENCY_SYMBOL[l.currency]}</span>}</div>
              <div className="mt-3 flex items-center gap-1 rounded-lg bg-sunken pl-2.5 pr-1 h-8">
                <span className="flex-1 truncate font-mono text-[12px] text-muted">{l.url.replace(/^https?:\/\//, '')}</span>
                <CopyButton text={l.url} label="Скопировать ссылку" />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-sunken py-1.5"><div className="font-semibold text-sm">{l.stats.opened}</div><div className="text-faint">переходов</div></div>
                <div className="rounded-lg bg-sunken py-1.5"><div className="font-semibold text-sm">{l.stats.paid_count}</div><div className="text-faint">оплат</div></div>
                <div className="rounded-lg bg-sunken py-1.5"><div className="font-semibold text-sm truncate px-1">{money(l.paidTotal, l.currency)}</div><div className="text-faint">собрано</div></div>
              </div>
              <div className="mt-3 pt-3 border-t border-line flex items-center justify-between gap-2">
                <span className="text-xs text-faint">{l.expires_at ? `до ${longDate(Date.parse(l.expires_at))}` : `создана ${dateTime(l.createdAt)}`}</span>
                <div className="flex items-center gap-0.5">
                  {l.status !== 'paid' && <Toggle checked={l.status !== 'disabled'} onChange={(v) => void toggle(l, v)} />}
                  <IconButton label="QR-код" onClick={() => setQr(l)}><QrCode className="size-4" /></IconButton>
                  <a href={l.url} target="_blank" rel="noreferrer"><IconButton label="Открыть"><ExternalLink className="size-4" /></IconButton></a>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {create && <CreateLink kind={create} onClose={() => setCreate(null)} onCreated={() => void qc.invalidateQueries({ queryKey: ['links', shop.id] })} />}
      {qr && <QrModal link={qr} onClose={() => setQr(null)} />}
    </div>
  );
}

type Item = { description: string; quantity: string; price: string; vat_code: string };

function CreateLink({ kind: initial, onClose, onCreated }: { kind: 'link' | 'invoice'; onClose: () => void; onCreated: () => void }) {
  const shop = useShop();
  const toast = useToast();
  const [kind, setKind] = useState(initial);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('RUB');
  const [fixed, setFixed] = useState(true);
  const [amount, setAmount] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [reusable, setReusable] = useState(true);
  const [expires, setExpires] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [items, setItems] = useState<Item[]>([{ description: '', quantity: '1', price: '', vat_code: shop.defaultVat }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ url: string } | null>(null);

  const total = items.reduce((s, it) => s + Math.round(Number(toAmount(it.price) ?? 0) * 100 * (Number(it.quantity.replace(',', '.')) || 0)), 0);

  const submit = async () => {
    setError(null);
    const body: Record<string, unknown> = { kind, title: title.trim(), description: description.trim() || undefined, currency, expiresAt: expires ? Date.parse(`${expires}T23:59:59+03:00`) : null };
    if (!body.title) return setError('Укажите название');
    if (kind === 'invoice') {
      const parsed = items.filter((it) => it.description.trim() || it.price);
      if (!parsed.length) return setError('Добавьте хотя бы одну позицию');
      for (const it of parsed) {
        if (!it.description.trim()) return setError('У каждой позиции должно быть название');
        if (!toAmount(it.price)) return setError(`Проверьте цену «${it.description}»`);
        if (!(Number(it.quantity.replace(',', '.')) > 0)) return setError(`Проверьте количество «${it.description}»`);
      }
      body.items = parsed.map((it) => ({ description: it.description.trim(), quantity: Number(it.quantity.replace(',', '.')), price: toAmount(it.price), vat_code: it.vat_code }));
      body.customer = { email: email.trim() || undefined, name: name.trim() || undefined };
    } else if (fixed) {
      const a = toAmount(amount);
      if (!a) return setError('Укажите сумму');
      body.amount = a;
      body.reusable = reusable;
    } else {
      if (min && !toAmount(min)) return setError('Проверьте минимальную сумму');
      if (max && !toAmount(max)) return setError('Проверьте максимальную сумму');
      body.minAmount = min ? toAmount(min) : undefined;
      body.maxAmount = max ? toAmount(max) : undefined;
      body.reusable = true;
    }
    setBusy(true);
    try {
      const r = await api<{ link: { url: string } }>(`/m/shops/${shop.id}/links`, { body });
      setCreated(r.link);
      onCreated();
      toast(kind === 'invoice' ? 'Счёт выставлен' : 'Ссылка создана');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <Modal open onClose={onClose} title={kind === 'invoice' ? 'Счёт готов' : 'Ссылка готова'} footer={<Button variant="primary" onClick={onClose}>Готово</Button>}>
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="rounded-2xl border border-line bg-white p-3"><QR text={created.url} className="size-40" /></div>
          <p className="text-sm text-muted">Отправьте ссылку покупателю — он сможет оплатить картой, через СБП, частями или криптовалютой.</p>
          <div className="w-full flex items-center gap-1 rounded-[10px] border border-line bg-sunken pl-3 pr-1 h-10">
            <span className="flex-1 truncate font-mono text-[13px] text-left">{created.url}</span>
            <CopyButton text={created.url} />
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} size="lg" title={kind === 'invoice' ? 'Новый счёт' : 'Новая ссылка на оплату'} footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" loading={busy} onClick={submit}>{kind === 'invoice' ? `Выставить счёт${total ? ` на ${money(total, currency)}` : ''}` : 'Создать ссылку'}</Button></>}>
      <div className="flex flex-col gap-4">
        <Segmented value={kind} onChange={setKind} className="w-full [&>button]:flex-1" options={[{ value: 'link', label: 'Ссылка' }, { value: 'invoice', label: 'Счёт с позициями' }]} />
        <div className="grid sm:grid-cols-[1fr_140px] gap-3">
          <Field label={kind === 'invoice' ? 'Номер / название счёта' : 'Что продаёте'}>
            <Input placeholder={kind === 'invoice' ? 'Счёт № 152 от 13 октября' : 'Абонемент на месяц'} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} autoFocus />
          </Field>
          <Field label="Валюта"><CurrencySelect value={currency} onChange={setCurrency} /></Field>
        </div>
        <Field label="Описание для покупателя (необязательно)">
          <Textarea className="!min-h-16" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </Field>

        {kind === 'link' ? (
          <>
            <Segmented value={fixed ? 'fixed' : 'free'} onChange={(v) => setFixed(v === 'fixed')} options={[{ value: 'fixed', label: 'Фиксированная сумма' }, { value: 'free', label: 'Покупатель вводит сумму' }]} />
            {fixed ? (
              <div className="grid sm:grid-cols-2 gap-3 items-end">
                <Field label={`Сумма, ${CURRENCY_SYMBOL[currency]}`}><Input inputMode="decimal" placeholder="1500" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                <div className="pb-2"><Toggle checked={reusable} onChange={setReusable} label="Многоразовая ссылка" /></div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Минимум (необязательно)"><Input inputMode="decimal" placeholder="100" value={min} onChange={(e) => setMin(e.target.value)} /></Field>
                <Field label="Максимум (необязательно)"><Input inputMode="decimal" placeholder="50000" value={max} onChange={(e) => setMax(e.target.value)} /></Field>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Плательщик"><Input placeholder="ИП Петров А. В." value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Email для чека"><Input type="email" placeholder="client@mail.ru" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            </div>
            <div>
              <div className="text-[13px] font-medium text-muted mb-1.5">Позиции чека</div>
              <div className="flex flex-col gap-2">
                {items.map((it, i) => (
                  <div key={i} className="grid grid-cols-[1fr_64px_96px] sm:grid-cols-[1fr_64px_110px_130px_36px] gap-2 items-center">
                    <Input placeholder="Название" value={it.description} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} aria-label="Название позиции" />
                    <Input inputMode="decimal" placeholder="Кол-во" value={it.quantity} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} aria-label="Количество" />
                    <Input inputMode="decimal" placeholder="Цена" value={it.price} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} aria-label="Цена" />
                    <Select value={it.vat_code} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, vat_code: e.target.value } : x)))} aria-label="НДС" className="col-span-2 sm:col-span-1">
                      {Object.entries(VAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                    <IconButton label="Удалить позицию" disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="size-4" /></IconButton>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setItems([...items, { description: '', quantity: '1', price: '', vat_code: shop.defaultVat }])}>Добавить позицию</Button>
                <span className="text-sm">Итого: <b className="tabular-nums">{money(total, currency, { exact: true })}</b></span>
              </div>
            </div>
          </>
        )}
        <Field label="Действует до (необязательно)">
          <Input type="date" value={expires} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setExpires(e.target.value)} className="w-auto sm:w-48" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

/** Printable "pay here" table card for a cash desk. */
function QrModal({ link, onClose }: { link: LinkItem; onClose: () => void }) {
  const shop = useShop();
  return (
    <Modal open onClose={onClose} title="QR-код для кассы" footer={<><Button onClick={onClose}>Закрыть</Button><Button variant="primary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Печать</Button></>}>
      <div id="gp-print" className="mx-auto w-full max-w-[320px] rounded-3xl border border-line bg-white text-[#0b0b14] p-6 flex flex-col items-center text-center print:border-0">
        <div className="flex items-center gap-2">
          <ShopAvatar shop={shop} className="size-8 text-sm" />
          <span className="font-semibold">{shop.name}</span>
        </div>
        <div className="mt-4 text-sm text-[#5e6178]">{link.title}</div>
        {link.amountMinor && <div className="text-2xl font-semibold tracking-tight">{money(link.amountMinor, link.currency, { exact: link.amountMinor % 100 !== 0 })}</div>}
        <div className="mt-4 rounded-2xl border-2 border-[#5b3df5] p-3"><QR text={link.url} className="size-48" /></div>
        <div className="mt-4 text-[15px] font-semibold">Наведите камеру, чтобы оплатить</div>
        <div className="mt-3 flex gap-1.5"><CardLogos /><PayLogo name="sbp" /></div>
        <div className="mt-4"><Logo size="sm" /></div>
      </div>
      <style>{`@media print { body * { visibility: hidden; } #gp-print, #gp-print * { visibility: visible; } #gp-print { position: fixed; left: 50%; top: 40px; transform: translateX(-50%); } }`}</style>
    </Modal>
  );
}
