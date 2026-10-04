import { Cpu, Pencil, Plus, Trash2, Usb } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HolderPicker, matches, SearchInput, useOwnerLabel } from '../components/common';
import {
  Badge, Button, Card, Empty, ErrorText, Field, IconButton, Input, Loading, Modal, Mono, PageHeader, Select, Table, TagInput, Textarea, td, th, trHover, useConfirm,
} from '../components/ui';
import { DEVICE_KIND, fmtDate, fmtDateTime } from '../lib/format';
import { useDeleteRecord, useRecords, useSaveRecord } from '../lib/queries';
import type { Device, DeviceData } from '../lib/types';

export const EMPTY_DEVICE: DeviceData = {
  kind: 'esp32', name: '', chip: '', mac: '', usbSerial: '', usbVid: '', usbPid: '', flashSize: '',
  firmware: { name: '', version: '', flashedAt: '' }, holder: { type: 'storage', id: null }, ztAddress: '', tags: [], notes: '',
};

export function DeviceModal({ device, initial, onClose }: { device: Device | null; initial?: Partial<DeviceData>; onClose: (saved?: Device) => void }) {
  const save = useSaveRecord('devices');
  const owner = useOwnerLabel();
  const [f, setF] = useState<DeviceData>({ ...EMPTY_DEVICE, ...(device ?? {}), ...(initial ?? {}) });
  const set = <K extends keyof DeviceData>(k: K, v: DeviceData[K]) => setF((x) => ({ ...x, [k]: v }));

  return (
    <Modal
      open
      wide
      onClose={() => onClose()}
      title={device ? device.name : 'Новое устройство'}
      footer={
        <>
          <Button onClick={() => onClose()}>Отмена</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ ...(device ? { id: device.id } : {}), ...f }, { onSuccess: (d) => onClose(d) })}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Тип">
          <Select value={f.kind} onChange={(e) => set('kind', e.target.value as DeviceData['kind'])}>
            <option value="esp32">ESP32</option>
            <option value="uno">Arduino Uno</option>
            <option value="other">Другое</option>
          </Select>
        </Field>
        <Field label="Название *">
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Датчик температуры #3" autoFocus={!device} />
        </Field>

        <div className="sm:col-span-2 mt-1 text-xs font-medium uppercase tracking-wider text-faint">Железо</div>
        <Field label="Чип">
          <Input value={f.chip} onChange={(e) => set('chip', e.target.value)} placeholder="ESP32-D0WD-V3 / ATmega328P" />
        </Field>
        <Field label="MAC">
          <Input mono value={f.mac} onChange={(e) => set('mac', e.target.value)} placeholder="aa:bb:cc:dd:ee:ff" />
        </Field>
        <Field label="Серийный номер USB">
          <Input mono value={f.usbSerial} onChange={(e) => set('usbSerial', e.target.value)} />
        </Field>
        <Field label="Flash">
          <Input value={f.flashSize} onChange={(e) => set('flashSize', e.target.value)} placeholder="4MB" />
        </Field>
        <Field label="USB VID">
          <Input mono value={f.usbVid} onChange={(e) => set('usbVid', e.target.value)} placeholder="10c4" />
        </Field>
        <Field label="USB PID">
          <Input mono value={f.usbPid} onChange={(e) => set('usbPid', e.target.value)} placeholder="ea60" />
        </Field>

        <div className="sm:col-span-2 mt-1 text-xs font-medium uppercase tracking-wider text-faint">Прошивка</div>
        <Field label="Название прошивки">
          <Input value={f.firmware.name} onChange={(e) => set('firmware', { ...f.firmware, name: e.target.value })} placeholder="sensor-node" />
        </Field>
        <Field label="Версия">
          <Input mono value={f.firmware.version} onChange={(e) => set('firmware', { ...f.firmware, version: e.target.value })} placeholder="1.4.2" />
        </Field>
        <Field label="Дата прошивки">
          <Input type="date" value={f.firmware.flashedAt} onChange={(e) => set('firmware', { ...f.firmware, flashedAt: e.target.value })} />
        </Field>
        <Field label="Адрес ZeroTier (Node ID / IP)">
          <Input mono value={f.ztAddress} onChange={(e) => set('ztAddress', e.target.value)} />
        </Field>

        <div className="sm:col-span-2 mt-1 text-xs font-medium uppercase tracking-wider text-faint">Где находится</div>
        <Field label="У кого сейчас" className="sm:col-span-2" hint={device ? 'При смене владельца передача автоматически попадёт в историю' : undefined}>
          <HolderPicker value={f.holder} onChange={(h) => set('holder', h)} />
        </Field>
        <Field label="Теги" className="sm:col-span-2">
          <TagInput value={f.tags} onChange={(v) => set('tags', v)} />
        </Field>
        <Field label="Заметки" className="sm:col-span-2">
          <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>

        {device && device.transfers.length > 0 && (
          <div className="sm:col-span-2">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">История передач</div>
            <ol className="flex flex-col gap-1.5 text-sm">
              {[...device.transfers].reverse().map((t, i) => (
                <li key={i} className="flex flex-wrap gap-x-2 text-muted">
                  <span className="text-faint">{fmtDateTime(t.ts)}</span>
                  <span>
                    {owner(t.from.type, t.from.id)} → <span className="text-fg">{owner(t.to.type, t.to.id)}</span>
                  </span>
                  <span className="text-faint">({t.by})</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <ErrorText error={save.error} />
    </Modal>
  );
}

export default function Devices() {
  const { data = [], isLoading } = useRecords('devices');
  const del = useDeleteRecord('devices');
  const owner = useOwnerLabel();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [holder, setHolder] = useState('');
  const [edit, setEdit] = useState<Device | 'new' | null>(null);

  const list = data
    .filter((d) => (!kind || d.kind === kind) && (!holder || d.holder.type === holder))
    .filter((d) => matches(q, d.name, d.chip, d.mac, d.usbSerial, d.firmware.name, d.firmware.version, d.ztAddress, d.tags, d.notes, owner(d.holder.type, d.holder.id)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  return (
    <>
      <PageHeader
        title="Устройства"
        description="Реестр ESP32 и Arduino: железо, прошивки и у кого устройство сейчас"
        actions={
          <>
            <Link to="/console" className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-elevated px-3.5 text-sm font-medium hover:bg-hover">
              <Usb className="size-4" /> USB-консоль
            </Link>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>
              Добавить
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Название, MAC, прошивка…" />
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="sm:w-40">
          <option value="">Все типы</option>
          <option value="esp32">ESP32</option>
          <option value="uno">Arduino Uno</option>
          <option value="other">Другое</option>
        </Select>
        <Select value={holder} onChange={(e) => setHolder(e.target.value)} className="sm:w-44">
          <option value="">Где угодно</option>
          <option value="storage">На складе</option>
          <option value="employee">У сотрудника</option>
          <option value="client">У клиента</option>
        </Select>
      </div>
      <Card>
        {isLoading ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty icon={<Cpu />} title={data.length ? 'Ничего не найдено' : 'Устройств пока нет'}>
            {!data.length && 'Подключите плату в USB-консоли и нажмите «Добавить в реестр» — данные заполнятся автоматически.'}
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Устройство</th>
                <th className={th}>Тип</th>
                <th className={`${th} hidden md:table-cell`}>MAC / чип</th>
                <th className={`${th} hidden lg:table-cell`}>Прошивка</th>
                <th className={th}>У кого</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.id} className={`${trHover} cursor-pointer`} onClick={() => setEdit(d)}>
                  <td className={td}>
                    <div className="font-medium">{d.name}</div>
                    {d.tags.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{d.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
                  </td>
                  <td className={td}>
                    <Badge>{DEVICE_KIND[d.kind]}</Badge>
                  </td>
                  <td className={`${td} hidden md:table-cell`}>
                    <Mono className="block">{d.mac || '—'}</Mono>
                    <span className="text-xs text-faint">{d.chip}</span>
                  </td>
                  <td className={`${td} hidden lg:table-cell`}>
                    {d.firmware.name ? (
                      <>
                        <span>{d.firmware.name}</span> <Mono className="text-muted">{d.firmware.version}</Mono>
                        <div className="text-xs text-faint">{fmtDate(d.firmware.flashedAt)}</div>
                      </>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className={td}>
                    <span className="text-xs text-faint">{d.holder.type === 'employee' ? 'Сотрудник' : d.holder.type === 'client' ? 'Клиент' : ''}</span>
                    <div>{owner(d.holder.type, d.holder.id)}</div>
                  </td>
                  <td className={`${td} text-right whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>
                    <IconButton label="Изменить" onClick={() => setEdit(d)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      label="Удалить"
                      onClick={async () => {
                        if (await confirm({ title: `Удалить «${d.name}»?`, body: 'Устройство попадёт в корзину на 30 дней.', danger: true, confirmText: 'Удалить' })) del.mutate(d.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {edit && <DeviceModal device={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}
