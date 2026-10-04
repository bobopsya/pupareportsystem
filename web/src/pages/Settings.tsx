import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup, KeyRound, Lock, Network, UserCog } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, ErrorText, Field, Input, Mono, PageHeader, useConfirm, useToast } from '../components/ui';
import { api, downloadFrom } from '../lib/api';
import { strength } from '../lib/password';
import { useVault } from '../lib/vault';
import { ChangePasswordForm } from './Login';
import { RecoveryCodeNotice, StrengthBar, VaultGate } from './Vault';

function ZtTokenCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { data } = useQuery({ queryKey: ['settings'], queryFn: () => api<{ ztTokenSet: boolean; ztApiUrl: string }>('/settings') });
  const [token, setToken] = useState('');
  const save = useMutation({
    mutationFn: () => api('/settings/zt-token', { method: 'PUT', body: { token } }),
    onSuccess: () => (setToken(''), toast('Токен сохранён', 'ok'), qc.invalidateQueries({ queryKey: ['settings'] })),
    onError: (e) => toast(e.message, 'bad'),
  });
  const remove = useMutation({
    mutationFn: () => api('/settings/zt-token', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Network className="size-4 text-muted" /> ZeroTier Central API
        </span>
      }
      actions={data && <Badge tone={data.ztTokenSet ? 'ok' : 'neutral'}>{data.ztTokenSet ? 'токен задан' : 'не настроено'}</Badge>}
    >
      <form
        className="flex flex-col gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-sm text-muted">
          Создайте токен в my.zerotier.com → Account → API Access Tokens. Токен хранится на сервере в зашифрованном виде и никогда не передаётся в браузер.
        </p>
        <Field label={data?.ztTokenSet ? 'Заменить токен' : 'API-токен'}>
          <Input mono type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="••••••••••••" />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={token.trim().length < 10} loading={save.isPending}>
            Сохранить
          </Button>
          {data?.ztTokenSet && (
            <Button
              variant="danger"
              onClick={async () => {
                if (await confirm({ title: 'Удалить токен ZeroTier?', body: 'Синхронизация перестанет работать, реестр останется.', danger: true, confirmText: 'Удалить' })) remove.mutate();
              }}
            >
              Удалить токен
            </Button>
          )}
          {data && <Mono className="ml-auto text-xs text-faint">{data.ztApiUrl}</Mono>}
        </div>
      </form>
    </Card>
  );
}

function MasterKeyCard() {
  const vault = useVault();
  const [m, setM] = useState({ a: '', b: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (m.a !== m.b) return setError(new Error('Ключи не совпадают'));
    if (m.a.length < 12 || strength(m.a) < 3) return setError(new Error('Слишком простой мастер-ключ (минимум 12 символов, лучше фраза из нескольких слов)'));
    setBusy(true);
    try {
      setCode(await vault.changeMaster(m.a));
      setM({ a: '', b: '' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Lock className="size-4 text-muted" /> Мастер-ключ хранилища паролей
        </span>
      }
    >
      <div className="p-4">
        {code ? (
          <RecoveryCodeNotice code={code} onDone={() => setCode(null)} />
        ) : (
          <VaultGate compact>
            <form onSubmit={submit} className="flex flex-col gap-3">
              <p className="text-sm text-muted">
                Смена ключа не перешифровывает пароли — меняется только «обёртка» ключа данных. После смены будет выдан <b className="text-fg">новый код восстановления</b>, старый
                перестанет работать. Сообщите новый ключ всем сотрудникам.
              </p>
              <Field label="Новый мастер-ключ">
                <Input type="password" autoComplete="new-password" value={m.a} onChange={(e) => setM({ ...m, a: e.target.value })} />
              </Field>
              <StrengthBar password={m.a} />
              <Field label="Повторите">
                <Input type="password" autoComplete="new-password" value={m.b} onChange={(e) => setM({ ...m, b: e.target.value })} />
              </Field>
              <ErrorText error={error} />
              <div>
                <Button type="submit" variant="primary" loading={busy}>
                  Сменить мастер-ключ
                </Button>
              </div>
            </form>
          </VaultGate>
        )}
      </div>
    </Card>
  );
}

function BackupCard() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <DatabaseBackup className="size-4 text-muted" /> Резервная копия
        </span>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted">
          Архив с базой данных и всеми файлами. Содержимое зашифровано ключами сервера (DB_KEY и FILES_KEY из файла <Mono>.env</Mono>) — без них архив не прочитать. Храните ключи отдельно от
          бэкапов. Инструкция по восстановлению — внутри архива.
        </p>
        <div>
          <Button
            variant="primary"
            loading={busy}
            icon={<DatabaseBackup className="size-4" />}
            onClick={async () => {
              setBusy(true);
              try {
                await downloadFrom('/backup');
              } catch (e) {
                toast((e as Error).message, 'bad');
              } finally {
                setBusy(false);
              }
            }}
          >
            Скачать бэкап
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function Settings() {
  const toast = useToast();
  return (
    <>
      <PageHeader title="Настройки" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title={
            <span className="flex items-center gap-2">
              <UserCog className="size-4 text-muted" /> Мой пароль
            </span>
          }
        >
          <div className="p-4">
            <ChangePasswordForm onDone={() => toast('Пароль изменён. Другие сессии завершены.', 'ok')} />
          </div>
        </Card>
        <div className="flex flex-col gap-5">
          <ZtTokenCard />
          <BackupCard />
        </div>
        <MasterKeyCard />
        <Card
          title={
            <span className="flex items-center gap-2">
              <KeyRound className="size-4 text-muted" /> Безопасность
            </span>
          }
        >
          <ul className="flex flex-col gap-2 p-4 text-sm text-muted">
            <li>• Автовыход через 30 минут бездействия; хранилище паролей блокируется через 5 минут.</li>
            <li>• После 5 неудачных попыток входа IP блокируется на 15 минут.</li>
            <li>• Пароли хранилища шифруются в браузере (AES-256-GCM, PBKDF2 600 000 итераций).</li>
            <li>• База данных и файлы на сервере зашифрованы; фото очищаются от EXIF/GPS.</li>
            <li>• Все входы, изменения и просмотры паролей пишутся в журнал.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
