import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2, X } from 'lucide-react';
import { Badge, Button, Card, Empty, Loading, PageHeader, Table, td, th, trHover, useConfirm, useToast } from '../components/ui';
import { api } from '../lib/api';
import { ENTITY_LABEL, fmtDateTime } from '../lib/format';
import { useEmployeeNames } from '../lib/queries';

interface TrashItem {
  kind: 'record' | 'employee' | 'file';
  id: string;
  type: string;
  title: string;
  deletedAt: number;
  deletedBy: string | null;
  purgeAt: number;
}

export default function Trash() {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const emp = useEmployeeNames();
  const { data = [], isLoading } = useQuery({ queryKey: ['trash'], queryFn: () => api<TrashItem[]>('/trash') });

  const refreshAll = () => qc.invalidateQueries();
  const restore = useMutation({
    mutationFn: (i: TrashItem) => api('/trash/restore', { body: { kind: i.kind, id: i.id } }),
    onSuccess: () => (toast('Восстановлено', 'ok'), refreshAll()),
    onError: (e) => toast(e.message, 'bad'),
  });
  const purge = useMutation({
    mutationFn: (i: TrashItem) => api('/trash/purge', { body: { kind: i.kind, id: i.id } }),
    onSuccess: () => (toast('Удалено навсегда'), refreshAll()),
    onError: (e) => toast(e.message, 'bad'),
  });

  const daysLeft = (ts: number) => Math.max(0, Math.ceil((ts - Date.now()) / 86_400_000));

  return (
    <>
      <PageHeader title="Корзина" description="Удалённое хранится 30 дней, затем стирается автоматически" />
      <Card>
        {isLoading ? (
          <Loading />
        ) : data.length === 0 ? (
          <Empty icon={<Trash2 />} title="Корзина пуста" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Что</th>
                <th className={th}>Тип</th>
                <th className={`${th} hidden md:table-cell`}>Удалил</th>
                <th className={`${th} hidden sm:table-cell`}>Когда</th>
                <th className={th}>Осталось</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {data.map((i) => (
                <tr key={`${i.kind}-${i.id}`} className={trHover}>
                  <td className={`${td} font-medium`}>{i.title}</td>
                  <td className={td}>
                    <Badge>{ENTITY_LABEL[i.type] ?? i.type}</Badge>
                  </td>
                  <td className={`${td} hidden md:table-cell text-muted`}>{emp(i.deletedBy)}</td>
                  <td className={`${td} hidden sm:table-cell text-xs text-faint whitespace-nowrap`}>{fmtDateTime(i.deletedAt)}</td>
                  <td className={`${td} text-xs text-muted whitespace-nowrap`}>{daysLeft(i.purgeAt)} дн.</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => restore.mutate(i)}>
                      Восстановить
                    </Button>{' '}
                    <Button
                      size="sm"
                      variant="danger"
                      icon={<X className="size-3.5" />}
                      onClick={async () => {
                        if (await confirm({ title: `Удалить «${i.title}» навсегда?`, body: 'Восстановить будет невозможно.', danger: true, confirmText: 'Удалить навсегда' })) purge.mutate(i);
                      }}
                    >
                      Навсегда
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
