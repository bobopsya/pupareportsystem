import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HelpCircle, Network, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClientSelect, matches, OwnerPicker, SearchInput, useOwnerLabel } from '../components/common';
import {
  AddRowButton, Badge, Button, Card, Checkbox, CopyButton, cx, Dot, Empty, ErrorText, Field, IconButton, Input, KV, Loading, Modal, Mono, PageHeader, Segmented,
  Select, Table, TagInput, Textarea, td, th, trHover, useConfirm, useToast,
} from '../components/ui';
import { api } from '../lib/api';
import { fmtAgo, fmtDateTime } from '../lib/format';
import { useClientNames, useDeleteRecord, useRecords, useSaveRecord } from '../lib/queries';
import type { ZtMember, ZtMemberData, ZtNetwork, ZtNetworkData } from '../lib/types';

const EMPTY_NET: ZtNetworkData = { networkId: '', name: '', clientId: null, subnets: [], routes: [], tags: [], notes: '', status: 'active' };

function NetworkModal({ net, onClose, onSaved }: { net: ZtNetwork | null; onClose: () => void; onSaved: (id: string) => void }) {
  const save = useSaveRecord('zt-networks');
  const [f, setF] = useState<ZtNetworkData>(net ? { ...EMPTY_NET, ...net } : EMPTY_NET);
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={net ? `Сеть «${net.name}»` : 'Новая сеть ZeroTier'}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ ...(net ? { id: net.id } : {}), ...f }, { onSuccess: (r) => (onSaved(r.id), onClose()) })}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Network ID *" hint="16 символов из my.zerotier.com">
          <Input mono value={f.networkId} onChange={(e) => setF({ ...f, networkId: e.target.value.trim() })} placeholder="8056c2e21c000001" maxLength={16} autoFocus={!net} />
        </Field>
        <Field label="Название *">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Офис / Клиент Иванов" />
        </Field>
        <Field label="Клиент">
          <ClientSelect value={f.clientId} onChange={(clientId) => setF({ ...f, clientId })} />
        </Field>
        <Field label="Статус">
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ZtNetworkData['status'] })}>
            <option value="active">Активна</option>
            <option value="archived">Архив</option>
          </Select>
        </Field>
        <Field label="Подсети" className="sm:col-span-2" hint="Enter — добавить">
          <TagInput mono value={f.subnets} onChange={(subnets) => setF({ ...f, subnets })} placeholder="10.147.17.0/24" />
        </Field>
        <div className="sm:col-span-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Маршруты</span>
            <AddRowButton onClick={() => setF({ ...f, routes: [...f.routes, { target: '', via: '' }] })}>Маршрут</AddRowButton>
          </div>
          {f.routes.length === 0 && <p className="text-xs text-faint">Нет маршрутов</p>}
          <div className="flex flex-col gap-2">
            {f.routes.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input mono placeholder="Цель: 192.168.1.0/24" value={r.target} onChange={(e) => setF({ ...f, routes: f.routes.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)) })} />
                <Input mono placeholder="Через (via), пусто = LAN" value={r.via} onChange={(e) => setF({ ...f, routes: f.routes.map((x, j) => (j === i ? { ...x, via: e.target.value } : x)) })} />
                <IconButton label="Удалить маршрут" onClick={() => setF({ ...f, routes: f.routes.filter((_, j) => j !== i) })}>
                  <X className="size-4" />
                </IconButton>
              </div>
            ))}
          </div>
        </div>
        <Field label="Теги" className="sm:col-span-2">
          <TagInput value={f.tags} onChange={(tags) => setF({ ...f, tags })} />
        </Field>
        <Field label="Заметки" className="sm:col-span-2">
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
      <ErrorText error={save.error} />
    </Modal>
  );
}

const EMPTY_MEMBER = (networkRef: string): ZtMemberData => ({
  networkRef, nodeId: '', name: '', ownerType: 'none', ownerId: null, ips: [], online: false, lastSeen: null, authorized: true, physicalAddress: '', clientVersion: '', notes: '', source: 'manual',
});

function MemberModal({ member, networkRef, onClose }: { member: ZtMember | null; networkRef: string; onClose: () => void }) {
  const save = useSaveRecord('zt-members');
  const [f, setF] = useState<ZtMemberData>(member ? { ...EMPTY_MEMBER(networkRef), ...member } : EMPTY_MEMBER(networkRef));
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={member ? `Узел ${member.name || member.nodeId}` : 'Новый узел'}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate({ ...(member ? { id: member.id } : {}), ...f }, { onSuccess: onClose })}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Node ID *" hint="10 символов (zerotier-cli info)">
          <Input mono value={f.nodeId} onChange={(e) => setF({ ...f, nodeId: e.target.value.trim() })} maxLength={10} disabled={!!member && member.source === 'sync'} autoFocus={!member} />
        </Field>
        <Field label="Имя">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ноутбук Ивана / ESP32 в гараже" />
        </Field>
        <Field label="Владелец" className="sm:col-span-2">
          <OwnerPicker type={f.ownerType} id={f.ownerId} types={['none', 'employee', 'client', 'device']} onChange={(ownerType, ownerId) => setF({ ...f, ownerType, ownerId })} />
        </Field>
        <Field label="IP-адреса" className="sm:col-span-2">
          <TagInput mono value={f.ips} onChange={(ips) => setF({ ...f, ips })} placeholder="10.147.17.5" />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox checked={f.authorized} onChange={(authorized) => setF({ ...f, authorized })} label="Авторизован в сети" />
        </div>
        <Field label="Заметки" className="sm:col-span-2">
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
      </div>
      {member?.source === 'sync' && <p className="mt-3 text-xs text-faint">IP, онлайн-статус и авторизация обновляются при синхронизации. Имя, владелец и заметки сохраняются.</p>}
      <ErrorText error={save.error} />
    </Modal>
  );
}

function JoinHelp({ net, onClose }: { net: ZtNetwork; onClose: () => void }) {
  const [os, setOs] = useState<'win' | 'linux' | 'mac'>('win');
  const id = net.networkId;
  const steps: Record<typeof os, { title: string; cmd?: string }[]> = {
    win: [
      { title: 'Скачайте и установите ZeroTier One: https://www.zerotier.com/download/' },
      { title: 'Откройте PowerShell от имени администратора и выполните:', cmd: `& "C:\\Program Files (x86)\\ZeroTier\\One\\zerotier-cli.bat" join ${id}` },
      { title: 'Или: значок ZeroTier в трее → Join New Network → вставьте ID:', cmd: id },
    ],
    linux: [
      { title: 'Установка:', cmd: 'curl -s https://install.zerotier.com | sudo bash' },
      { title: 'Подключение к сети:', cmd: `sudo zerotier-cli join ${id}` },
      { title: 'Узнать свой Node ID:', cmd: 'sudo zerotier-cli info' },
    ],
    mac: [
      { title: 'Установите ZeroTier One: https://www.zerotier.com/download/ (или brew install --cask zerotier-one)' },
      { title: 'Подключение к сети:', cmd: `sudo zerotier-cli join ${id}` },
      { title: 'Узнать свой Node ID:', cmd: 'sudo zerotier-cli info' },
    ],
  };
  return (
    <Modal open onClose={onClose} title={`Как подключиться к «${net.name}»`} wide>
      <div className="flex flex-col gap-4">
        <Segmented
          value={os}
          onChange={setOs}
          options={[
            { id: 'win', label: 'Windows' },
            { id: 'linux', label: 'Linux' },
            { id: 'mac', label: 'macOS' },
          ]}
        />
        <ol className="flex flex-col gap-3">
          {steps[os].map((s, i) => (
            <li key={i} className="text-sm">
              <span className="text-muted">
                {i + 1}. {s.title}
              </span>
              {s.cmd && (
                <div className="mt-1.5 flex items-center gap-2 rounded-md border border-line bg-elevated px-3 py-2">
                  <Mono className="min-w-0 flex-1 break-all">{s.cmd}</Mono>
                  <CopyButton value={s.cmd} />
                </div>
              )}
            </li>
          ))}
        </ol>
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted">
          После подключения узел нужно авторизовать в my.zerotier.com (Members → Auth). Затем нажмите «Синхронизировать» на портале, чтобы узел появился в реестре.
        </p>
      </div>
    </Modal>
  );
}

function NetworkDetail({ net, onEdit }: { net: ZtNetwork; onEdit: () => void }) {
  const { data: members = [], isLoading } = useRecords('zt-members', { networkRef: net.id });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<{ ztTokenSet: boolean }>('/settings') });
  const del = useDeleteRecord('zt-members');
  const delNet = useDeleteRecord('zt-networks');
  const owner = useOwnerLabel();
  const cli = useClientNames();
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  const [memberEdit, setMemberEdit] = useState<ZtMember | 'new' | null>(null);
  const [help, setHelp] = useState(false);
  const [q, setQ] = useState('');

  const sync = useMutation({
    mutationFn: () => api<{ added: number; updated: number; total: number }>(`/zt-networks/${net.id}/sync`, { method: 'POST' }),
    onSuccess: (r) => {
      toast(`Синхронизировано: ${r.total} узлов (новых ${r.added})`, 'ok');
      qc.invalidateQueries({ queryKey: ['zt-members'] });
      qc.invalidateQueries({ queryKey: ['zt-networks'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast(e.message, 'bad'),
  });

  const list = members
    .filter((m) => matches(q, m.name, m.nodeId, m.ips, m.notes, owner(m.ownerType, m.ownerId)))
    .sort((a, b) => Number(b.online) - Number(a.online) || (a.name || a.nodeId).localeCompare(b.name || b.nodeId));

  return (
    <div className="flex flex-col gap-5">
      <Card
        title={
          <span className="flex items-center gap-2">
            {net.name} {net.status === 'archived' && <Badge>архив</Badge>}
          </span>
        }
        actions={
          <>
            <Button size="sm" variant="ghost" icon={<HelpCircle className="size-3.5" />} onClick={() => setHelp(true)}>
              Как подключиться
            </Button>
            <IconButton label="Изменить сеть" onClick={onEdit}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton
              label="Удалить сеть"
              onClick={async () => {
                if (await confirm({ title: `Удалить сеть «${net.name}»?`, body: 'Сеть и её узлы попадут в корзину на 30 дней. В самом ZeroTier ничего не изменится.', danger: true, confirmText: 'Удалить' }))
                  delNet.mutate(net.id);
              }}
            >
              <Trash2 className="size-4" />
            </IconButton>
          </>
        }
      >
        <div className="grid gap-x-8 px-4 py-3 md:grid-cols-2">
          <div>
            <KV label="Network ID">
              <span className="inline-flex items-center gap-1">
                <Mono>{net.networkId}</Mono>
                <CopyButton value={net.networkId} />
              </span>
            </KV>
            <KV label="Клиент">{net.clientId ? <Link to={`/clients/${net.clientId}`} className="underline decoration-line-strong underline-offset-4 hover:decoration-fg">{cli(net.clientId)}</Link> : null}</KV>
            <KV label="Подсети">{net.subnets.length ? <Mono>{net.subnets.join(', ')}</Mono> : null}</KV>
            <KV label="Пулы IP">{net.poolsInfo?.length ? <Mono>{net.poolsInfo.join(', ')}</Mono> : null}</KV>
          </div>
          <div>
            <KV label="Маршруты">
              {net.routes.length ? (
                <span className="flex flex-col">
                  {net.routes.map((r, i) => (
                    <Mono key={i}>
                      {r.target} {r.via ? `→ ${r.via}` : '(LAN)'}
                    </Mono>
                  ))}
                </span>
              ) : null}
            </KV>
            <KV label="Теги">{net.tags.length ? <span className="flex flex-wrap gap-1">{net.tags.map((t) => <Badge key={t}>{t}</Badge>)}</span> : null}</KV>
            <KV label="Синхронизация">{net.lastSync ? `${fmtDateTime(net.lastSync)} (${fmtAgo(net.lastSync)})` : 'не выполнялась'}</KV>
          </div>
          {net.notes && <p className="whitespace-pre-wrap border-t border-line pt-3 text-sm text-muted md:col-span-2">{net.notes}</p>}
        </div>
      </Card>

      <Card
        title={`Узлы (${members.length})`}
        actions={
          <>
            <Button
              size="sm"
              icon={<RefreshCw className={cx('size-3.5', sync.isPending && 'animate-spin')} />}
              disabled={!settings.data?.ztTokenSet || sync.isPending}
              title={settings.data?.ztTokenSet ? 'Подтянуть узлы и онлайн-статус из ZeroTier Central' : 'Сначала задайте API-токен в Настройках'}
              onClick={() => sync.mutate()}
            >
              Синхронизировать
            </Button>
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setMemberEdit('new')}>
              Узел
            </Button>
          </>
        }
      >
        {!settings.data?.ztTokenSet && (
          <p className="border-b border-line px-4 py-2 text-xs text-faint">
            Синхронизация с my.zerotier.com выключена: <Link to="/settings" className="underline">задайте API-токен</Link>. Узлы можно вести вручную.
          </p>
        )}
        {members.length > 5 && (
          <div className="border-b border-line p-3">
            <SearchInput value={q} onChange={setQ} placeholder="Имя, Node ID, IP, владелец…" />
          </div>
        )}
        {isLoading ? (
          <Loading />
        ) : list.length === 0 ? (
          <Empty title="Узлов нет">Добавьте узел вручную или синхронизируйте сеть.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Узел</th>
                <th className={th}>Node ID</th>
                <th className={th}>IP</th>
                <th className={`${th} hidden md:table-cell`}>Владелец</th>
                <th className={`${th} hidden lg:table-cell`}>Последний раз</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id} className={trHover}>
                  <td className={td}>
                    <div className="flex items-center gap-2.5">
                      <Dot on={m.online} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{m.name || <span className="text-faint">без имени</span>}</div>
                        <div className="flex gap-1">
                          {!m.authorized && <Badge tone="warn">не авторизован</Badge>}
                          {m.source === 'sync' && <span className="text-[11px] text-faint">из Central</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className={td}>
                    <Mono className="text-muted">{m.nodeId}</Mono>
                  </td>
                  <td className={td}>
                    <Mono>{m.ips.join(', ') || '—'}</Mono>
                  </td>
                  <td className={`${td} hidden md:table-cell text-muted`}>{m.ownerType === 'none' ? '—' : owner(m.ownerType, m.ownerId)}</td>
                  <td className={`${td} hidden lg:table-cell text-xs text-faint whitespace-nowrap`}>{m.online ? 'онлайн' : fmtAgo(m.lastSeen)}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    <IconButton label="Изменить" onClick={() => setMemberEdit(m)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      label="Удалить"
                      onClick={async () => {
                        if (await confirm({ title: 'Удалить узел из реестра?', body: 'В ZeroTier узел останется. При следующей синхронизации он появится снова.', danger: true, confirmText: 'Удалить' }))
                          del.mutate(m.id);
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

      {memberEdit && <MemberModal member={memberEdit === 'new' ? null : memberEdit} networkRef={net.id} onClose={() => setMemberEdit(null)} />}
      {help && <JoinHelp net={net} onClose={() => setHelp(false)} />}
    </div>
  );
}

export default function ZeroTier() {
  const { data: nets = [], isLoading } = useRecords('zt-networks');
  const { data: members = [] } = useRecords('zt-members');
  const cli = useClientNames();
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<ZtNetwork | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const visible = nets.filter((n) => showArchived || n.status === 'active').sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const current = nets.find((n) => n.id === sel) ?? visible[0];

  return (
    <>
      <PageHeader
        title="ZeroTier"
        description="Реестр сетей и узлов. Синхронизация с my.zerotier.com подтягивает узлы и их онлайн-статус."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit('new')}>
            Добавить сеть
          </Button>
        }
      />
      {isLoading ? (
        <Loading />
      ) : nets.length === 0 ? (
        <Card>
          <Empty icon={<Network />} title="Сетей пока нет">
            Добавьте сеть по её Network ID из my.zerotier.com.
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          <div className="flex flex-col gap-2">
            {visible.map((n) => {
              const ms = members.filter((m) => m.networkRef === n.id);
              const on = ms.filter((m) => m.online).length;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSel(n.id)}
                  className={cx('rounded-lg border px-3.5 py-3 text-left transition-colors', current?.id === n.id ? 'border-fg/60 bg-elevated' : 'border-line bg-surface hover:border-line-strong')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{n.name}</span>
                    <span className="flex items-center gap-1.5 text-xs text-muted">
                      <Dot on={on > 0} /> {on}/{ms.length}
                    </span>
                  </div>
                  <Mono className="mt-1 block text-xs text-faint">{n.networkId}</Mono>
                  {n.clientId && <div className="mt-1 truncate text-xs text-muted">{cli(n.clientId)}</div>}
                </button>
              );
            })}
            {nets.some((n) => n.status === 'archived') && (
              <div className="px-1 pt-1">
                <Checkbox checked={showArchived} onChange={setShowArchived} label={<span className="text-xs text-muted">Показывать архивные</span>} />
              </div>
            )}
          </div>
          {current ? <NetworkDetail key={current.id} net={current} onEdit={() => setEdit(current)} /> : <Empty title="Выберите сеть" />}
        </div>
      )}
      {edit && <NetworkModal net={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={setSel} />}
    </>
  );
}
