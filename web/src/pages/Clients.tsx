import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, Download, FileText, ImagePlus, MapPin, MoreHorizontal, Paperclip, Plus, Save, Star, Trash2, Upload, UserRound, X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar, CoordsInput, EmployeeSelect, matches, SearchInput } from '../components/common';
import {
  AddRowButton, Badge, Button, Card, Dot, Empty, ErrorText, Field, IconButton, Input, Loading, Modal, Mono, PageHeader, Select, SidePanel, Table, Tabs, TagInput,
  Textarea, td, th, trHover, useConfirm, useToast, cx,
} from '../components/ui';
import { api, downloadFrom, fileUrl, uploadFile, type FileMeta } from '../lib/api';
import { parseLatLng } from '../lib/geo';
import { CLIENT_STATUS, EVENT_KIND, fmtAgo, fmtBytes, fmtDate, fmtDateTime, today, uid } from '../lib/format';
import { useDeleteRecord, useEmployeeNames, useRecords, useSaveRecord } from '../lib/queries';
import type { Client, ClientData, ClientEventKind, InfraRow } from '../lib/types';
import { ClientRoutes } from './Routes';
import { VaultLinkedList } from './Vault';

export const EMPTY_CLIENT: ClientData = {
  fullName: '', status: 'new', responsibleId: null, phones: [], emails: [], messengers: { telegram: '', whatsapp: '', signal: '' }, address: '', mapUrl: '', lat: null, lng: null,
  birthDate: '', document: { type: '', number: '' }, serviceStart: '', tariff: '', tags: [], customFields: [], infra: [], avatarFileId: null, notes: '',
};

function NewClientModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const save = useSaveRecord('clients');
  const [f, setF] = useState({ ...EMPTY_CLIENT, phone: '' });
  return (
    <Modal
      open
      onClose={onClose}
      title="Новый клиент"
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              const { phone, ...rest } = f;
              save.mutate({ ...rest, phones: phone.trim() ? [phone.trim()] : [] }, { onSuccess: (c) => onCreated(c.id) });
            }}
          >
            Создать и открыть
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="ФИО *">
          <Input autoFocus value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Телефон">
            <Input value={f.phone} inputMode="tel" onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
          <Field label="Статус">
            <StatusSelect value={f.status} onChange={(status) => setF({ ...f, status })} />
          </Field>
        </div>
        <Field label="Ответственный сотрудник">
          <EmployeeSelect value={f.responsibleId} onChange={(responsibleId) => setF({ ...f, responsibleId })} />
        </Field>
        <p className="text-xs text-faint">Остальные данные, фото и файлы можно добавить в карточке клиента.</p>
        <ErrorText error={save.error} />
      </div>
    </Modal>
  );
}

function StatusSelect({ value, onChange }: { value: ClientData['status']; onChange: (v: ClientData['status']) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as ClientData['status'])}>
      {Object.entries(CLIENT_STATUS).map(([k, v]) => (
        <option key={k} value={k}>
          {v.label}
        </option>
      ))}
    </Select>
  );
}

// ---------------- Overview (main data) ----------------

function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-5 sm:px-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-faint">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

function OverviewTab({ client }: { client: Client }) {
  const save = useSaveRecord('clients');
  const toast = useToast();
  const [f, setF] = useState<ClientData>({ ...EMPTY_CLIENT, ...client });
  useEffect(() => setF({ ...EMPTY_CLIENT, ...client }), [client]);
  const dirty = JSON.stringify(f) !== JSON.stringify({ ...EMPTY_CLIENT, ...client });
  const set = <K extends keyof ClientData>(k: K, v: ClientData[K]) => setF((x) => ({ ...x, [k]: v }));
  const avatarRef = useRef<HTMLInputElement>(null);

  const submit = () =>
    save.mutate({ ...client, ...f }, { onSuccess: () => toast('Карточка сохранена', 'ok'), onError: (e) => toast(e.message, 'bad') });

  const mapHref = f.mapUrl || (f.address ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(f.address)}` : '');

  return (
    <div className="pb-20">
      <Section title="Основное">
        <div className="mb-4 flex items-center gap-4">
          <Avatar name={f.fullName} fileId={f.avatarFileId} size={72} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => avatarRef.current?.click()}>
              Фото клиента
            </Button>
            {f.avatarFileId && (
              <Button size="sm" variant="ghost" onClick={() => set('avatarFileId', null)}>
                Убрать
              </Button>
            )}
            <input
              ref={avatarRef}
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const meta = await uploadFile(file, { ownerType: 'client', ownerId: client.id, kind: 'avatar' });
                  set('avatarFileId', meta.id);
                } catch (err) {
                  toast((err as Error).message, 'bad');
                }
              }}
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ФИО *" className="sm:col-span-2">
            <Input value={f.fullName} onChange={(e) => set('fullName', e.target.value)} />
          </Field>
          <Field label="Статус">
            <StatusSelect value={f.status} onChange={(v) => set('status', v)} />
          </Field>
          <Field label="Ответственный">
            <EmployeeSelect value={f.responsibleId} onChange={(v) => set('responsibleId', v)} />
          </Field>
          <Field label="Начало обслуживания">
            <Input type="date" value={f.serviceStart} onChange={(e) => set('serviceStart', e.target.value)} />
          </Field>
          <Field label="Тариф">
            <Input value={f.tariff} onChange={(e) => set('tariff', e.target.value)} />
          </Field>
          <Field label="Теги" className="sm:col-span-2">
            <TagInput value={f.tags} onChange={(v) => set('tags', v)} placeholder="VIP, умный дом…" />
          </Field>
        </div>
      </Section>

      <Section title="Контакты">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Телефоны" hint="Enter — добавить ещё">
            <TagInput value={f.phones} onChange={(v) => set('phones', v)} placeholder="+49 …" />
          </Field>
          <Field label="Email">
            <TagInput value={f.emails} onChange={(v) => set('emails', v)} placeholder="name@mail.com" />
          </Field>
          <Field label="Telegram">
            <Input value={f.messengers.telegram} onChange={(e) => set('messengers', { ...f.messengers, telegram: e.target.value })} placeholder="@username" />
          </Field>
          <Field label="WhatsApp">
            <Input value={f.messengers.whatsapp} onChange={(e) => set('messengers', { ...f.messengers, whatsapp: e.target.value })} />
          </Field>
          <Field label="Signal">
            <Input value={f.messengers.signal} onChange={(e) => set('messengers', { ...f.messengers, signal: e.target.value })} />
          </Field>
        </div>
      </Section>

      <Section title="Адрес объекта">
        <div className="grid gap-4">
          <Field label="Адрес">
            <Textarea className="min-h-16" value={f.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <div className="flex items-end gap-2">
            <Field label="Ссылка на карту (необязательно)" className="flex-1">
              <Input
                value={f.mapUrl}
                onChange={(e) => {
                  const url = e.target.value;
                  // A pasted Google/Yandex link already carries the coordinates.
                  const ll = f.lat === null ? parseLatLng(url) : null;
                  setF((x) => ({ ...x, mapUrl: url, ...(ll ?? {}) }));
                }}
                placeholder="https://maps…"
              />
            </Field>
            {mapHref && (
              <a href={mapHref} target="_blank" rel="noreferrer noopener" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line px-3 text-sm text-muted hover:text-fg">
                <MapPin className="size-4" /> Карта
              </a>
            )}
          </div>
          <Field label="Координаты объекта" hint="Для общей карты. «широта, долгота» или ссылка Google/Яндекс Карт.">
            <CoordsInput lat={f.lat} lng={f.lng} onChange={(lat, lng) => setF((x) => ({ ...x, lat, lng }))} />
          </Field>
        </div>
      </Section>

      <Section title="Документы">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Дата рождения">
            <Input type="date" value={f.birthDate} onChange={(e) => set('birthDate', e.target.value)} />
          </Field>
          <Field label="Тип документа">
            <Input value={f.document.type} onChange={(e) => set('document', { ...f.document, type: e.target.value })} placeholder="Паспорт / Personalausweis" />
          </Field>
          <Field label="Номер документа">
            <Input mono value={f.document.number} onChange={(e) => set('document', { ...f.document, number: e.target.value })} />
          </Field>
        </div>
      </Section>

      <Section
        title="Свои поля"
        actions={<AddRowButton onClick={() => set('customFields', [...f.customFields, { key: '', value: '' }])}>Поле</AddRowButton>}
      >
        {f.customFields.length === 0 ? (
          <p className="text-sm text-faint">Добавьте любые данные, для которых нет отдельного поля: код домофона, Wi-Fi, пожелания…</p>
        ) : (
          <div className="flex flex-col gap-2">
            {f.customFields.map((cf, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-2">
                <Input placeholder="Название" value={cf.key} onChange={(e) => set('customFields', f.customFields.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
                <Input placeholder="Значение" value={cf.value} onChange={(e) => set('customFields', f.customFields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                <IconButton label="Удалить поле" onClick={() => set('customFields', f.customFields.filter((_, j) => j !== i))}>
                  <X className="size-4" />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Заметки">
        <Textarea className="min-h-28" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </Section>

      <div className={cx('sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur sm:px-5', !dirty && 'hidden')}>
        <span className="mr-auto text-xs text-warn">Есть несохранённые изменения</span>
        <Button onClick={() => setF({ ...EMPTY_CLIENT, ...client })}>Отменить</Button>
        <Button variant="primary" icon={<Save className="size-4" />} loading={save.isPending} onClick={submit}>
          Сохранить
        </Button>
      </div>
    </div>
  );
}

// ---------------- Infrastructure ----------------

const INFRA_TYPES = ['Роутер', 'ПК', 'Ноутбук', 'Сервер', 'NAS', 'Камера', 'ESP32', 'Arduino', 'Датчик', 'Телефон', 'Другое'];

function InfraTab({ client }: { client: Client }) {
  const save = useSaveRecord('clients');
  const toast = useToast();
  const [rows, setRows] = useState<InfraRow[]>(client.infra);
  useEffect(() => setRows(client.infra), [client]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(client.infra);
  const { data: networks = [] } = useRecords('zt-networks', { clientId: client.id });
  const { data: members = [] } = useRecords('zt-members', { ownerType: 'client', ownerId: client.id });
  const { data: devices = [] } = useRecords('devices');
  const { data: allNets = [] } = useRecords('zt-networks');
  const clientDevices = devices.filter((d) => d.holder.type === 'client' && d.holder.id === client.id);
  const upd = (i: number, patch: Partial<InfraRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const inputCls = 'h-8 w-full min-w-24 rounded border border-transparent bg-transparent px-2 text-sm hover:border-line focus:border-line-strong focus:bg-surface focus:outline-none';

  return (
    <div>
      <Section
        title="Устройства и адреса клиента"
        actions={<AddRowButton onClick={() => setRows([...rows, { id: uid(), name: '', type: 'Роутер', localIp: '', ztIp: '', mac: '', note: '' }])}>Строка</AddRowButton>}
      >
        {rows.length === 0 ? (
          <p className="text-sm text-faint">Записывайте сюда оборудование клиента: роутер, ПК, камеры, датчики — с локальными и ZeroTier IP-адресами.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr>
                  {['Имя', 'Тип', 'Локальный IP', 'ZeroTier IP', 'MAC', 'Заметка', ''].map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td className="border-b border-line/70 py-1 pl-3">
                      <input className={inputCls} value={r.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="Имя" />
                    </td>
                    <td className="border-b border-line/70 py-1">
                      <select className={cx(inputCls, 'bg-bg')} value={r.type} onChange={(e) => upd(i, { type: e.target.value })}>
                        {[...new Set([...INFRA_TYPES, r.type])].map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </td>
                    <td className="border-b border-line/70 py-1">
                      <input className={cx(inputCls, 'font-mono')} value={r.localIp} onChange={(e) => upd(i, { localIp: e.target.value })} placeholder="192.168.0.1" />
                    </td>
                    <td className="border-b border-line/70 py-1">
                      <input className={cx(inputCls, 'font-mono')} value={r.ztIp} onChange={(e) => upd(i, { ztIp: e.target.value })} placeholder="10.147.x.x" />
                    </td>
                    <td className="border-b border-line/70 py-1">
                      <input className={cx(inputCls, 'font-mono')} value={r.mac} onChange={(e) => upd(i, { mac: e.target.value })} placeholder="aa:bb:…" />
                    </td>
                    <td className="border-b border-line/70 py-1">
                      <input className={inputCls} value={r.note} onChange={(e) => upd(i, { note: e.target.value })} />
                    </td>
                    <td className="border-b border-line/70 py-1 pr-3">
                      <IconButton label="Удалить строку" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                        <X className="size-4" />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {dirty && (
          <div className="mt-3 flex justify-end gap-2">
            <Button onClick={() => setRows(client.infra)}>Отменить</Button>
            <Button
              variant="primary"
              icon={<Save className="size-4" />}
              loading={save.isPending}
              onClick={() => save.mutate({ ...client, infra: rows }, { onSuccess: () => toast('Сохранено', 'ok'), onError: (e) => toast(e.message, 'bad') })}
            >
              Сохранить
            </Button>
          </div>
        )}
      </Section>

      <Section title={`Сети ZeroTier (${networks.length})`}>
        {networks.length === 0 ? (
          <p className="text-sm text-faint">Нет сетей, привязанных к клиенту. Привязка делается в разделе ZeroTier.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {networks.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
                <span className="font-medium">{n.name}</span>
                <Mono className="text-muted">{n.networkId}</Mono>
                <span className="text-xs text-faint">{n.subnets.join(', ')}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Узлы ZeroTier клиента (${members.length})`}>
        {members.length === 0 ? (
          <p className="text-sm text-faint">Узлы с владельцем «этот клиент» появятся здесь.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-md border border-line px-3 py-2 text-sm">
                <Dot on={m.online} />
                <span className="font-medium">{m.name || m.nodeId}</span>
                <Mono className="text-muted">{m.ips.join(', ')}</Mono>
                <span className="ml-auto text-xs text-faint">{allNets.find((n) => n.id === m.networkRef)?.name}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Устройства из реестра (${clientDevices.length})`}>
        {clientDevices.length === 0 ? (
          <p className="text-sm text-faint">ESP32/Arduino, выданные этому клиенту (раздел «Устройства» → «У кого сейчас»).</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {clientDevices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-md border border-line px-3 py-2 text-sm">
                <span className="font-medium">{d.name}</span>
                <Badge>{d.kind === 'esp32' ? 'ESP32' : d.kind === 'uno' ? 'Uno' : 'Другое'}</Badge>
                <Mono className="text-muted">{d.mac}</Mono>
                <span className="ml-auto text-xs text-faint">{d.firmware.name} {d.firmware.version}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Маршруты выездов">
        <ClientRoutes clientId={client.id} />
      </Section>
    </div>
  );
}

// ---------------- Photos & files ----------------

function useFiles(clientId: string, kind: 'photo' | 'file') {
  return useQuery({ queryKey: ['files', 'client', clientId, kind], queryFn: () => api<FileMeta[]>(`/files?ownerType=client&ownerId=${clientId}&kind=${kind}`) });
}

function useUploader(clientId: string, kind: 'photo' | 'file') {
  const qc = useQueryClient();
  const toast = useToast();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setProgress({ done: 0, total: list.length });
    for (const [i, file] of list.entries()) {
      try {
        if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: больше 20 МБ`);
        await uploadFile(file, { ownerType: 'client', ownerId: clientId, kind });
      } catch (e) {
        toast((e as Error).message, 'bad');
      }
      setProgress({ done: i + 1, total: list.length });
    }
    setProgress(null);
    qc.invalidateQueries({ queryKey: ['files', 'client', clientId, kind] });
  };
  return { upload, progress };
}

function DropZone({ onFiles, accept, children, busy }: { onFiles: (f: FileList) => void; accept?: string; children: ReactNode; busy?: string | null }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles(e.dataTransfer.files);
      }}
      onClick={() => ref.current?.click()}
      className={cx('flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center text-sm transition-colors', over ? 'border-fg bg-hover' : 'border-line-strong text-muted hover:border-fg hover:text-fg')}
    >
      {busy ?? children}
      <input ref={ref} type="file" multiple accept={accept} hidden onChange={(e) => e.target.files && onFiles(e.target.files)} />
    </div>
  );
}

function PhotosTab({ client }: { client: Client }) {
  const { data = [], isLoading } = useFiles(client.id, 'photo');
  const { upload, progress } = useUploader(client.id, 'photo');
  const [view, setView] = useState<number | null>(null);
  const qc = useQueryClient();
  const save = useSaveRecord('clients');
  const confirm = useConfirm();
  const toast = useToast();
  const refresh = () => qc.invalidateQueries({ queryKey: ['files', 'client', client.id, 'photo'] });
  const current = view !== null ? data[view] : null;

  useEffect(() => {
    if (view === null) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setView((v) => (v === null ? v : (v + 1) % data.length));
      if (e.key === 'ArrowLeft') setView((v) => (v === null ? v : (v - 1 + data.length) % data.length));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [view, data.length]);

  return (
    <div className="p-4 sm:p-5">
      <DropZone accept="image/*" onFiles={(f) => void upload(f)} busy={progress && `Загрузка ${progress.done}/${progress.total}…`}>
        <ImagePlus className="size-6" />
        <span>Перетащите фото сюда или нажмите, чтобы выбрать</span>
        <span className="text-xs text-faint">До 20 МБ. Фото сжимаются, метаданные (EXIF, GPS) удаляются.</span>
      </DropZone>
      {isLoading ? (
        <Loading />
      ) : data.length === 0 ? (
        <Empty title="Фото пока нет" />
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {data.map((f, i) => (
            <figure key={f.id} className="group overflow-hidden rounded-lg border border-line bg-surface">
              <button type="button" className="block aspect-square w-full bg-hover" onClick={() => setView(i)}>
                <img src={fileUrl(f.id, { thumb: true })} alt={f.caption} loading="lazy" className="size-full object-cover transition-opacity group-hover:opacity-90" />
              </button>
              <figcaption className="truncate px-2.5 py-1.5 text-xs text-muted">{f.caption || <span className="text-faint">{fmtDate(new Date(f.createdAt).toISOString())}</span>}</figcaption>
            </figure>
          ))}
        </div>
      )}

      {current && (
        <Modal
          open
          wide="xl"
          onClose={() => setView(null)}
          title={`Фото ${view! + 1} из ${data.length}`}
          footer={
            <>
              <Button
                variant="danger"
                className="mr-auto"
                icon={<Trash2 className="size-4" />}
                onClick={async () => {
                  if (!(await confirm({ title: 'Удалить фото?', body: 'Фото попадёт в корзину на 30 дней.', danger: true, confirmText: 'Удалить' }))) return;
                  await api(`/files/${current.id}`, { method: 'DELETE' });
                  setView(null);
                  refresh();
                }}
              >
                Удалить
              </Button>
              <Button
                icon={<Star className="size-4" />}
                onClick={() => save.mutate({ ...client, avatarFileId: current.id }, { onSuccess: () => toast('Фото назначено аватаром', 'ok') })}
              >
                Сделать аватаром
              </Button>
              <a href={fileUrl(current.id, { download: true })} className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-elevated px-3.5 text-sm hover:bg-hover">
                <Download className="size-4" /> Скачать
              </a>
            </>
          }
        >
          <div className="relative flex items-center justify-center rounded-md bg-black">
            <img src={fileUrl(current.id)} alt={current.caption} className="max-h-[62dvh] w-auto object-contain" />
            {data.length > 1 && (
              <>
                <IconButton label="Предыдущее" className="absolute left-2 bg-black/60" onClick={() => setView((view! - 1 + data.length) % data.length)}>
                  <ChevronLeft className="size-5" />
                </IconButton>
                <IconButton label="Следующее" className="absolute right-2 bg-black/60" onClick={() => setView((view! + 1) % data.length)}>
                  <ChevronRight className="size-5" />
                </IconButton>
              </>
            )}
          </div>
          <CaptionEditor key={current.id} file={current} onSaved={refresh} />
          <p className="mt-2 text-xs text-faint">
            {fmtDateTime(current.createdAt)} · {fmtBytes(current.size)}
          </p>
        </Modal>
      )}
    </div>
  );
}

function CaptionEditor({ file, onSaved }: { file: FileMeta; onSaved: () => void }) {
  const [caption, setCaption] = useState(file.caption);
  return (
    <div className="mt-3 flex gap-2">
      <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Подпись к фото" />
      <Button disabled={caption === file.caption} onClick={async () => (await api(`/files/${file.id}`, { method: 'PATCH', body: { caption } }), onSaved())}>
        Сохранить
      </Button>
    </div>
  );
}

function FilesTab({ client }: { client: Client }) {
  const { data = [], isLoading } = useFiles(client.id, 'file');
  const { upload, progress } = useUploader(client.id, 'file');
  const qc = useQueryClient();
  const confirm = useConfirm();
  const emp = useEmployeeNames();
  return (
    <div className="p-4 sm:p-5">
      <DropZone onFiles={(f) => void upload(f)} busy={progress && `Загрузка ${progress.done}/${progress.total}…`}>
        <Paperclip className="size-6" />
        <span>Перетащите документы сюда или нажмите, чтобы выбрать</span>
        <span className="text-xs text-faint">PDF, договоры, отчёты — до 20 МБ. Хранятся зашифрованными.</span>
      </DropZone>
      {isLoading ? (
        <Loading />
      ) : data.length === 0 ? (
        <Empty title="Файлов пока нет" />
      ) : (
        <ul className="mt-4 divide-y divide-line/70 rounded-lg border border-line">
          {data.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2.5">
              <FileText className="size-5 shrink-0 text-faint" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{f.name}</div>
                <div className="text-xs text-faint">
                  {fmtBytes(f.size)} · {fmtDateTime(f.createdAt)} · {emp(f.createdBy)}
                </div>
              </div>
              <a href={fileUrl(f.id, { download: true })} className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg" title="Скачать" aria-label="Скачать">
                <Download className="size-4" />
              </a>
              <IconButton
                label="Удалить"
                onClick={async () => {
                  if (!(await confirm({ title: `Удалить «${f.name}»?`, body: 'Файл попадёт в корзину на 30 дней.', danger: true, confirmText: 'Удалить' }))) return;
                  await api(`/files/${f.id}`, { method: 'DELETE' });
                  qc.invalidateQueries({ queryKey: ['files', 'client', client.id, 'file'] });
                }}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------- History ----------------

function HistoryTab({ client }: { client: Client }) {
  const { data = [], isLoading } = useRecords('client-events', { clientId: client.id });
  const save = useSaveRecord('client-events');
  const del = useDeleteRecord('client-events');
  const emp = useEmployeeNames();
  const [f, setF] = useState({ kind: 'call' as ClientEventKind, date: today(), text: '' });
  const sorted = [...data].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  return (
    <div className="p-4 sm:p-5">
      <form
        className="rounded-lg border border-line bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (f.text.trim()) save.mutate({ ...f, clientId: client.id }, { onSuccess: () => setF({ ...f, text: '' }) });
        }}
      >
        <div className="mb-2 grid grid-cols-2 gap-2 sm:w-96">
          <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ClientEventKind })}>
            {Object.entries(EVENT_KIND).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </div>
        <Textarea placeholder="Что произошло: о чём договорились, что сделали на выезде…" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
        <div className="mt-2 flex justify-end">
          <Button type="submit" variant="primary" icon={<Plus className="size-4" />} loading={save.isPending}>
            Добавить запись
          </Button>
        </div>
      </form>

      {isLoading ? (
        <Loading />
      ) : sorted.length === 0 ? (
        <Empty title="История пуста" />
      ) : (
        <ol className="relative mt-6 ml-2 border-l border-line">
          {sorted.map((ev) => (
            <li key={ev.id} className="group relative mb-5 pl-5">
              <span className="absolute -left-[5px] top-1.5 size-2.5 rounded-full border-2 border-bg bg-fg" />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge>{EVENT_KIND[ev.kind]}</Badge>
                <span>{fmtDate(ev.date)}</span>
                <span className="text-faint">· {emp(ev.createdBy)}</span>
                <IconButton label="Удалить запись" className="ml-auto size-7 opacity-0 group-hover:opacity-100" onClick={() => del.mutate(ev.id)}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{ev.text}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------- Panel ----------------

type TabId = 'overview' | 'infra' | 'photos' | 'files' | 'history' | 'passwords';

function ClientPanel({ client, onClose }: { client: Client; onClose: () => void }) {
  const [tab, setTab] = useState<TabId>('overview');
  const [menu, setMenu] = useState(false);
  const del = useDeleteRecord('clients');
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  const st = CLIENT_STATUS[client.status]!;

  const exportZip = async () => {
    setMenu(false);
    try {
      await downloadFrom(`/clients/${client.id}/export`);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };
  const toTrash = async () => {
    setMenu(false);
    if (!(await confirm({ title: 'Удалить клиента?', body: 'Карточка попадёт в корзину. В течение 30 дней её можно восстановить.', danger: true, confirmText: 'В корзину' }))) return;
    await del.mutateAsync(client.id);
    onClose();
  };
  const purge = async () => {
    setMenu(false);
    if (
      !(await confirm({
        title: 'Удалить все данные клиента навсегда?',
        body: (
          <>
            Будут безвозвратно удалены карточка, фото, файлы и история клиента <b className="text-fg">{client.fullName}</b>. Так исполняется запрос на удаление данных по GDPR/DSGVO. Отменить
            нельзя.
          </>
        ),
        danger: true,
        confirmText: 'Удалить навсегда',
      }))
    )
      return;
    await api(`/clients/${client.id}/permanent`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['clients'] });
    onClose();
  };

  return (
    <SidePanel
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-3">
          <Avatar name={client.fullName} fileId={client.avatarFileId} size={32} />
          <span className="truncate">{client.fullName}</span>
          <Badge tone={st.tone}>{st.label}</Badge>
        </span>
      }
      actions={
        <div className="relative">
          <IconButton label="Действия" onClick={() => setMenu((m) => !m)}>
            <MoreHorizontal className="size-4" />
          </IconButton>
          {menu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
              <div className="absolute right-0 top-9 z-20 w-64 rounded-lg border border-line bg-elevated p-1 shadow-xl">
                <button type="button" className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-hover" onClick={exportZip}>
                  <Download className="size-4" /> Экспорт всех данных (ZIP)
                </button>
                <button type="button" className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-hover" onClick={toTrash}>
                  <Trash2 className="size-4" /> В корзину
                </button>
                <button type="button" className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-bad hover:bg-bad/10" onClick={purge}>
                  <X className="size-4" /> Удалить навсегда (GDPR)
                </button>
              </div>
            </>
          )}
        </div>
      }
    >
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Обзор' },
          { id: 'infra', label: 'Инфраструктура' },
          { id: 'photos', label: 'Фото' },
          { id: 'files', label: 'Файлы' },
          { id: 'history', label: 'История' },
          { id: 'passwords', label: 'Пароли' },
        ]}
      />
      {tab === 'overview' && <OverviewTab client={client} />}
      {tab === 'infra' && <InfraTab client={client} />}
      {tab === 'photos' && <PhotosTab client={client} />}
      {tab === 'files' && <FilesTab client={client} />}
      {tab === 'history' && <HistoryTab client={client} />}
      {tab === 'passwords' && (
        <div className="p-4 sm:p-5">
          <VaultLinkedList clientId={client.id} />
        </div>
      )}
    </SidePanel>
  );
}

// ---------------- Page ----------------

export default function Clients() {
  const { data, isLoading } = useRecords('clients');
  const params = useParams();
  const navigate = useNavigate();
  const emp = useEmployeeNames();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [resp, setResp] = useState<string | null>(null);
  const [tag, setTag] = useState('');
  const [creating, setCreating] = useState(false);

  const tags = useMemo(() => Array.from(new Set((data ?? []).flatMap((c) => c.tags))).sort(), [data]);
  const list = (data ?? [])
    .filter((c) => (!status || c.status === status) && (!resp || c.responsibleId === resp) && (!tag || c.tags.includes(tag)))
    .filter((c) => matches(q, c.fullName, c.phones, c.emails, c.address, c.tags, c.messengers.telegram, c.notes, c.infra.map((i) => `${i.name} ${i.localIp} ${i.ztIp} ${i.mac}`)))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'));
  const selected = params.id ? data?.find((c) => c.id === params.id) : undefined;

  return (
    <>
      <PageHeader
        title="Клиенты"
        description="Карточки клиентов: контакты, оборудование, фото, документы и история работы"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Новый клиент
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="ФИО, телефон, адрес, IP…" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="lg:w-40">
            <option value="">Любой статус</option>
            {Object.entries(CLIENT_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
          <div className="lg:w-52">
            <EmployeeSelect value={resp} onChange={setResp} emptyLabel="Любой ответственный" includeFired />
          </div>
          <Select value={tag} onChange={(e) => setTag(e.target.value)} className="lg:w-40">
            <option value="">Все теги</option>
            {tags.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </div>
        <span className="text-xs text-faint lg:ml-auto">{list.length} из {data?.length ?? 0}</span>
      </div>

      <Card>
        {isLoading ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon={<UserRound />} title={data?.length ? 'Никого не найдено' : 'Клиентов пока нет'}>
            {!data?.length && 'Нажмите «Новый клиент», чтобы завести первую карточку.'}
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Клиент</th>
                <th className={th}>Статус</th>
                <th className={`${th} hidden md:table-cell`}>Телефон</th>
                <th className={`${th} hidden lg:table-cell`}>Ответственный</th>
                <th className={`${th} hidden xl:table-cell`}>Теги</th>
                <th className={`${th} hidden sm:table-cell`}>Изменён</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={cx(trHover, 'cursor-pointer', c.id === params.id && 'bg-hover')} onClick={() => navigate(`/clients/${c.id}`)}>
                  <td className={td}>
                    <div className="flex items-center gap-3">
                      <Avatar name={c.fullName} fileId={c.avatarFileId} size={32} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{c.fullName}</div>
                        <div className="truncate text-xs text-faint">{c.address.split('\n')[0]}</div>
                      </div>
                    </div>
                  </td>
                  <td className={td}>
                    <Badge tone={CLIENT_STATUS[c.status]!.tone}>{CLIENT_STATUS[c.status]!.label}</Badge>
                  </td>
                  <td className={`${td} hidden md:table-cell text-muted whitespace-nowrap`}>{c.phones[0] ?? '—'}</td>
                  <td className={`${td} hidden lg:table-cell text-muted`}>{emp(c.responsibleId)}</td>
                  <td className={`${td} hidden xl:table-cell`}>
                    <div className="flex flex-wrap gap-1">
                      {c.tags.slice(0, 3).map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className={`${td} hidden sm:table-cell text-xs text-faint whitespace-nowrap`}>{fmtAgo(c.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {creating && (
        <NewClientModal
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(`/clients/${id}`);
          }}
        />
      )}
      {selected && <ClientPanel key={selected.id} client={selected} onClose={() => navigate('/clients')} />}
      {params.id && data && !selected && (
        <Modal open onClose={() => navigate('/clients')} title="Клиент не найден">
          <p className="text-sm text-muted">Возможно, карточка удалена. Проверьте корзину.</p>
        </Modal>
      )}
    </>
  );
}

