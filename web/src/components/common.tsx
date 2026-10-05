import { useEffect, useState } from 'react';
import { fileUrl } from '../lib/api';
import { initials } from '../lib/format';
import { parseLatLng } from '../lib/geo';
import { useEmployees, useRecords } from '../lib/queries';
import type { Holder, OwnerType } from '../lib/types';
import { cx, Input, NoFieldId, Select } from './ui';

const fmtLatLng = (lat: number | null, lng: number | null) => (lat === null || lng === null ? '' : `${lat}, ${lng}`);

/**
 * Text field for "lat, lng" (also accepts a Google/Yandex Maps link). Shows the parsed
 * value back once it is valid, and stays in sync when coordinates change elsewhere.
 */
export function CoordsInput({ lat, lng, onChange }: { lat: number | null; lng: number | null; onChange: (lat: number | null, lng: number | null) => void }) {
  const [text, setText] = useState(() => fmtLatLng(lat, lng));
  // Only reacts to outside changes (e.g. coordinates taken from a pasted map link), not to typing.
  useEffect(() => {
    const ll = parseLatLng(text);
    if (ll?.lat !== (lat ?? undefined) || ll?.lng !== (lng ?? undefined)) setText(fmtLatLng(lat, lng));
  }, [lat, lng]);
  const invalid = text.trim() !== '' && !parseLatLng(text);
  return (
    <>
      <Input
        mono
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const ll = parseLatLng(e.target.value);
          onChange(ll?.lat ?? null, ll?.lng ?? null);
        }}
        placeholder="55.7558, 37.6173"
        aria-invalid={invalid}
        className={invalid ? 'border-bad/60' : undefined}
      />
      {invalid && <span className="text-xs text-bad">Не удалось распознать координаты</span>}
    </>
  );
}

export function Avatar({ name, fileId, size = 36, className }: { name: string; fileId?: string | null; size?: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.36) };
  if (fileId) return <img src={fileUrl(fileId, { thumb: true })} alt="" style={style} className={cx('shrink-0 rounded-full object-cover bg-hover', className)} />;
  return (
    <div style={style} className={cx('flex shrink-0 items-center justify-center rounded-full border border-line bg-hover font-medium text-muted', className)}>
      {initials(name) || '?'}
    </div>
  );
}

export function EmployeeSelect({ value, onChange, emptyLabel = '— не назначен —', includeFired }: { value: string | null; onChange: (v: string | null) => void; emptyLabel?: string; includeFired?: boolean }) {
  const { data = [] } = useEmployees();
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {data
        .filter((e) => includeFired || e.status !== 'fired' || e.id === value)
        .map((e) => (
          <option key={e.id} value={e.id}>
            {e.fullName}
          </option>
        ))}
    </Select>
  );
}

export function ClientSelect({ value, onChange, emptyLabel = '— без клиента —' }: { value: string | null; onChange: (v: string | null) => void; emptyLabel?: string }) {
  const { data = [] } = useRecords('clients');
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {[...data]
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'))
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.fullName}
          </option>
        ))}
    </Select>
  );
}

export function DeviceSelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { data = [] } = useRecords('devices');
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— выберите устройство —</option>
      {data.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </Select>
  );
}

/** Picks "who owns this": employee / client / device / nobody. */
export function OwnerPicker({ type, id, onChange, types }: { type: OwnerType; id: string | null; onChange: (type: OwnerType, id: string | null) => void; types: OwnerType[] }) {
  const LABEL: Record<OwnerType, string> = { none: 'Не указан', employee: 'Сотрудник', client: 'Клиент', device: 'Устройство' };
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <Select value={type} onChange={(e) => onChange(e.target.value as OwnerType, null)}>
        {types.map((t) => (
          <option key={t} value={t}>
            {LABEL[t]}
          </option>
        ))}
      </Select>
      <NoFieldId>
        {type === 'employee' && <EmployeeSelect value={id} onChange={(v) => onChange(type, v)} emptyLabel="— выберите —" />}
        {type === 'client' && <ClientSelect value={id} onChange={(v) => onChange(type, v)} emptyLabel="— выберите —" />}
        {type === 'device' && <DeviceSelect value={id} onChange={(v) => onChange(type, v)} />}
      </NoFieldId>
    </div>
  );
}

/** Where a device is: in storage, with an employee or with a client. */
export function HolderPicker({ value, onChange }: { value: Holder; onChange: (h: Holder) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <Select value={value.type} onChange={(e) => onChange({ type: e.target.value as Holder['type'], id: null })}>
        <option value="storage">На складе</option>
        <option value="employee">У сотрудника</option>
        <option value="client">У клиента</option>
      </Select>
      <NoFieldId>
        {value.type === 'employee' && <EmployeeSelect value={value.id} onChange={(id) => onChange({ ...value, id })} emptyLabel="— выберите —" />}
        {value.type === 'client' && <ClientSelect value={value.id} onChange={(id) => onChange({ ...value, id })} emptyLabel="— выберите —" />}
      </NoFieldId>
    </div>
  );
}

export function useOwnerLabel() {
  const { data: employees = [] } = useEmployees();
  const { data: clients = [] } = useRecords('clients');
  const { data: devices = [] } = useRecords('devices');
  return (type: OwnerType | Holder['type'], id: string | null): string => {
    if (type === 'storage') return 'Склад';
    if (type === 'none' || !id) return '—';
    if (type === 'employee') return employees.find((e) => e.id === id)?.fullName ?? 'сотрудник удалён';
    if (type === 'client') return clients.find((c) => c.id === id)?.fullName ?? 'клиент удалён';
    return devices.find((d) => d.id === id)?.name ?? 'устройство удалено';
  };
}

export function SearchInput({ value, onChange, placeholder = 'Поиск…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative w-full sm:w-72">
      <svg className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-sm placeholder:text-faint focus:border-line-strong focus:outline-none"
      />
    </div>
  );
}

/** Case-insensitive match of a query against any of the given values. */
export function matches(q: string, ...values: unknown[]) {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return values.some((v) => (Array.isArray(v) ? v.join(' ') : String(v ?? '')).toLowerCase().includes(s));
}
