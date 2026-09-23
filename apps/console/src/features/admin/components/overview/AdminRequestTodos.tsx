import { Link } from '@tanstack/react-router';
import { ApiRequestPageSchema } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useAdminRead } from '../../../../shared/admin/useAdminRead';
import { useT } from '../../../../shared/lib/useT';
import { AdminTodoCard } from './AdminTodoCard';
import styles from './AdminTodos.module.css';
import { ButtonLink } from '../../../../shared/ui/navigation/ButtonLink';

/** RFC-018 下线出站申请后只剩定向开放一类待办。 */
export function AdminRequestTodos() {
  const t = useT(), request = { state: 'pending' as const, limit: 5 };
  const { query } = useAdminRead(queryKeys.accessRequestPage(request), async () => {
    const result = ApiRequestPageSchema.safeParse(await api.apiCatalog.listRequestPage(request));
    if (!result.success || result.data.items.length > 5 || result.data.items.some((r) => r.state !== 'pending' || r.project && r.project.id !== r.projectId) ||
      new Set(result.data.items.map((r) => r.id)).size !== result.data.items.length) throw new Error(t('admin.todo.invalid')); return result.data;
  });
  const items = [401, 403, 404].includes(query.error?.status ?? 0) ? [] : query.data?.items ?? [], current = !query.error;
  return <AdminTodoCard title={t('admin.todo.api')} pending={query.isPending} error={query.error}
    count={query.data ? items.length : undefined} more={!!query.data?.nextCursor}
    open={<ButtonLink to="/admin/requests" search={{ state: 'pending' }}>{t('admin.todo.openRequests')}</ButtonLink>}>
    {items.length ? <ul className={styles.list}>{items.map((item) => <li key={item.id}><div className={styles.title}>{current ? <Link to="/admin/requests" search={{ state: 'pending', projectId: item.projectId }}>{item.operationId}</Link>
      : <span>{item.operationId}</span>}</div><div className={styles.muted}>{item.project ? `${item.project.name} · ${item.project.slug}` : item.projectId}</div>
      {item.reason ? <p>{item.reason}</p> : null}</li>)}</ul> : null}
  </AdminTodoCard>;
}
