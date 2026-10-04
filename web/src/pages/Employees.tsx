import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LayoutGrid, Mail, Phone, Plus, Send, Table2, Trash2, Upload, Users } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Avatar, matches, SearchInput } from '../components/common';
import {
  Badge, Button, Card, CopyButton, Empty, ErrorText, Field, Input, Loading, Modal, Mono, PageHeader, Segmented, Select, Table, TagInput, Textarea,
  td, th, trHover, useConfirm, useToast,
} from '../components/ui';
import { api, uploadFile } from '../lib/api';
import { useAuth } from '../lib/auth';
import { EMPLOYEE_STATUS, fmtDate } from '../lib/format';
import { useEmployees } from '../lib/queries';
import type { Employee, EmployeeProfile } from '../lib/types';

const EMPTY: EmployeeProfile = {
  fullName: '', position: '', department: '', phone: '', email: '', telegram: '', skills: [], status: 'active', hiredAt: '', notes: '', avatarFileId: null,
};

function TempPasswordNotice({ login, password }: { login: string; password: string }) {
  return (
    <div className="rounded-lg border border-line bg-elevated p-4">
      <p className="text-sm text-muted">Передайте сотруднику данные для входа. Временный пароль показывается один раз — при первом входе его нужно сменить.</p>
      <div className="mt-3 grid gap-2 text-sm">
        <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2">
          <span className="text-muted">Логин</span>
          <span className="flex items-center gap-1">
            <Mono>{login}</Mono>
            <CopyButton value={login} />
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2">
          <span className="text-muted">Пароль</span>
          <span className="flex items-center gap-1">
            <Mono>{password}</Mono>
            <CopyButton value={password} />
          </span>
        </div>
      </div>
    </div>
  );
}

function EmployeeModal({ employee, onClose }: { employee: Employee | 'new'; onClose: () => void }) {
  const isNew = employee === 'new';
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const [form, setForm] = useState<EmployeeProfile>(isNew ? EMPTY : { ...EMPTY, ...employee });
  const [login, setLogin] = useState('');
  const [created, setCreated] = useState<{ login: string; password: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof EmployeeProfile>(k: K, v: EmployeeProfile[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) {
        const r = await api<{ employee: Employee; tempPassword: string }>('/employees', { body: { login, profile: form } });
        setCreated({ login: r.employee.login, password: r.tempPassword });
      } else {
        await api(`/employees/${employee.id}`, { method: 'PUT', body: form });
        onClose();
        toast('Сохранено', 'ok');
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
    onError: setError,
  });

  const reset = useMutation({
    mutationFn: () => api<{ tempPassword: string }>(`/employees/${(employee as Employee).id}/reset-password`, { method: 'POST' }),
    onSuccess: (r) => setCreated({ login: (employee as Employee).login, password: r.tempPassword }),
    onError: (e) => toast((e as Error).message, 'bad'),
  });

  const remove = async () => {
    if (isNew) return;
    if (!(await confirm({ title: 'Удалить сотрудника?', body: `${employee.fullName} больше не сможет войти. Запись можно восстановить из корзины в течение 30 дней.`, danger: true, confirmText: 'Удалить' }))) return;
    try {
      await api(`/employees/${employee.id}`, { method: 'DELETE' });
      qc.invalidateQueries({ queryKey: ['employees'] });
      onClose();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  const onAvatar = async (file: File | undefined) => {
    if (!file || isNew) return;
    try {
      const f = await uploadFile(file, { ownerType: 'employee', ownerId: employee.id, kind: 'avatar' });
      set('avatarFileId', f.id);
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };

  if (created) {
    return (
      <Modal open onClose={onClose} title={isNew ? 'Сотрудник добавлен' : 'Пароль сброшен'} footer={<Button variant="primary" onClick={onClose}>Готово</Button>}>
        <TempPasswordNotice login={created.login} password={created.password} />
      </Modal>
    );
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={isNew ? 'Новый сотрудник' : form.fullName || 'Сотрудник'}
      footer={
        <>
          {!isNew && employee.id !== user?.id && (
            <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={remove} className="mr-auto">
              Удалить
            </Button>
          )}
          {!isNew && (
            <Button icon={<KeyRound className="size-4" />} loading={reset.isPending} onClick={() => reset.mutate()}>
              Сбросить пароль
            </Button>
          )}
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            {isNew ? 'Создать' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {!isNew && (
          <div className="flex items-center gap-4">
            <Avatar name={form.fullName} fileId={form.avatarFileId} size={64} />
            <div className="flex gap-2">
              <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => fileRef.current?.click()}>
                Загрузить фото
              </Button>
              {form.avatarFileId && (
                <Button size="sm" variant="ghost" onClick={() => set('avatarFileId', null)}>
                  Убрать
                </Button>
              )}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onAvatar(e.target.files?.[0])} />
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ФИО *">
            <Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} autoFocus />
          </Field>
          {isNew ? (
            <Field label="Логин для входа *" hint="Латиница, цифры, точка, дефис">
              <Input mono value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" />
            </Field>
          ) : (
            <Field label="Логин">
              <Input mono value={employee.login} disabled />
            </Field>
          )}
          <Field label="Должность">
            <Input value={form.position} onChange={(e) => set('position', e.target.value)} placeholder="Pentester" />
          </Field>
          <Field label="Отдел">
            <Input value={form.department} onChange={(e) => set('department', e.target.value)} placeholder="Red Team" />
          </Field>
          <Field label="Телефон">
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" />
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={(e) => set('email', e.target.value)} type="email" />
          </Field>
          <Field label="Telegram">
            <Input value={form.telegram} onChange={(e) => set('telegram', e.target.value)} placeholder="@username" />
          </Field>
          <Field label="Статус">
            <Select value={form.status} onChange={(e) => set('status', e.target.value as EmployeeProfile['status'])}>
              <option value="active">Активен</option>
              <option value="vacation">Отпуск</option>
              <option value="fired">Уволен (вход заблокирован)</option>
            </Select>
          </Field>
          <Field label="Дата найма">
            <Input type="date" value={form.hiredAt} onChange={(e) => set('hiredAt', e.target.value)} />
          </Field>
          <Field label="Навыки и сертификаты" hint="Enter — добавить" className="sm:col-span-2">
            <TagInput value={form.skills} onChange={(v) => set('skills', v)} placeholder="OSCP, Web, Network…" />
          </Field>
          <Field label="Заметки" className="sm:col-span-2">
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}

function EmployeeCard({ e, onOpen }: { e: Employee; onOpen: () => void }) {
  const st = EMPLOYEE_STATUS[e.status]!;
  return (
    <button type="button" onClick={onOpen} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 text-left transition-colors hover:border-line-strong">
      <div className="flex items-start gap-3">
        <Avatar name={e.fullName} fileId={e.avatarFileId} size={44} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{e.fullName}</div>
          <div className="truncate text-sm text-muted">{[e.position, e.department].filter(Boolean).join(' · ') || '—'}</div>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <div className="flex flex-col gap-1 text-xs text-muted">
        {e.phone && (
          <span className="flex items-center gap-2">
            <Phone className="size-3.5 text-faint" /> {e.phone}
          </span>
        )}
        {e.email && (
          <span className="flex items-center gap-2 truncate">
            <Mail className="size-3.5 text-faint" /> {e.email}
          </span>
        )}
        {e.telegram && (
          <span className="flex items-center gap-2">
            <Send className="size-3.5 text-faint" /> {e.telegram}
          </span>
        )}
      </div>
      {e.skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {e.skills.slice(0, 6).map((s) => (
            <Badge key={s}>{s}</Badge>
          ))}
          {e.skills.length > 6 && <Badge>+{e.skills.length - 6}</Badge>}
        </div>
      )}
    </button>
  );
}

const VIEW_KEY = 'zn.employees.view';

export default function Employees() {
  const { data, isLoading } = useEmployees();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState<'cards' | 'table'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'cards';
    } catch {
      return 'cards';
    }
  });
  const [open, setOpen] = useState<Employee | 'new' | null>(null);

  const departments = useMemo(() => Array.from(new Set((data ?? []).map((e) => e.department).filter(Boolean))).sort(), [data]);
  const list = (data ?? [])
    .filter((e) => (!dept || e.department === dept) && (!status || e.status === status))
    .filter((e) => matches(q, e.fullName, e.login, e.position, e.department, e.phone, e.email, e.telegram, e.skills))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'));

  const changeView = (v: 'cards' | 'table') => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <PageHeader
        title="Сотрудники"
        description="Команда ZhukoNet. Добавление сотрудника создаёт ему учётную запись для входа."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen('new')}>
            Добавить
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Имя, логин, навык…" />
        <Select value={dept} onChange={(e) => setDept(e.target.value)} className="sm:w-48">
          <option value="">Все отделы</option>
          {departments.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-40">
          <option value="">Любой статус</option>
          <option value="active">Активен</option>
          <option value="vacation">Отпуск</option>
          <option value="fired">Уволен</option>
        </Select>
        <div className="sm:ml-auto">
          <Segmented
            value={view}
            onChange={changeView}
            options={[
              { id: 'cards', label: <LayoutGrid className="size-3.5" />, title: 'Карточки' },
              { id: 'table', label: <Table2 className="size-3.5" />, title: 'Таблица' },
            ]}
          />
        </div>
      </div>

      {isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Card>
          <Empty icon={<Users />} title="Никого не найдено" />
        </Card>
      ) : view === 'cards' ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {list.map((e) => (
            <EmployeeCard key={e.id} e={e} onOpen={() => setOpen(e)} />
          ))}
        </div>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th className={th}>Сотрудник</th>
                <th className={th}>Логин</th>
                <th className={th}>Должность / отдел</th>
                <th className={th}>Контакты</th>
                <th className={th}>Найм</th>
                <th className={th}>Статус</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className={`${trHover} cursor-pointer`} onClick={() => setOpen(e)}>
                  <td className={td}>
                    <div className="flex items-center gap-3">
                      <Avatar name={e.fullName} fileId={e.avatarFileId} size={30} />
                      <span className="font-medium">{e.fullName}</span>
                    </div>
                  </td>
                  <td className={td}>
                    <Mono className="text-muted">{e.login}</Mono>
                  </td>
                  <td className={`${td} text-muted`}>{[e.position, e.department].filter(Boolean).join(' · ') || '—'}</td>
                  <td className={`${td} text-muted`}>{[e.phone, e.email, e.telegram].filter(Boolean).join(' · ') || '—'}</td>
                  <td className={`${td} text-muted whitespace-nowrap`}>{fmtDate(e.hiredAt)}</td>
                  <td className={td}>
                    <Badge tone={EMPLOYEE_STATUS[e.status]!.tone}>{EMPLOYEE_STATUS[e.status]!.label}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {open && <EmployeeModal employee={open} onClose={() => setOpen(null)} />}
    </>
  );
}
