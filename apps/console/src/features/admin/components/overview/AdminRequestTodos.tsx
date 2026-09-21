import { Link } from '@tanstack/react-router';
import { ApiRequestPageSchema, EgressRequestPageSchema } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useAdminRead } from '../../../../shared/admin/useAdminRead';
import { useT } from '../../../../shared/lib/useT';
import { AdminTodoCard } from './AdminTodoCard';
import styles from './AdminTodos.module.css';

export function AdminRequestTodos({ kind }: { readonly kind: 'api' | 'egress' }) {
  const t = useT(), request = { state: 'pending' as const, limit: 5 };
  const { query, refresh, refreshing } = useAdminRead(kind === 'api' ? queryKeys.accessRequestPage(request) : queryKeys.egressRequestPage(request), async () => {
    const result = kind === 'api' ? ApiRequestPageSchema.safeParse(await api.apiCatalog.listRequestPage(request)) : EgressRequestPageSchema.safeParse(await api.egress.listRequestPage(request));
    if (!result.success || result.data.items.length > 5 || result.data.items.some((r) => r.state !== 'pending' || r.project && r.project.id !== r.projectId) ||
      new Set(result.data.items.map((r) => r.id)).size !== result.data.items.length) throw new Error(t('admin.todo.invalid')); return result.data;
  });
  const items = [401, 403, 404].includes(query.error?.status ?? 0) ? [] : query.data?.items ?? [], current = !refreshing && !query.error;
  return <AdminTodoCard title={t(`admin.todo.${kind}`)} refreshLabel={t(`admin.todo.refresh.${kind}`)} pending={query.isPending} error={query.error} busy={refreshing}
    count={query.data ? items.length : undefined} more={!!query.data?.nextCursor} checkedAt={query.dataUpdatedAt} refresh={refresh}
    open={<Link to="/admin/requests" search={{ tab: kind, state: 'pending' }}>{t('admin.todo.openRequests')}</Link>}>
    {items.length ? <ul className={styles.list}>{items.map((item) => <li key={item.id}><div className={styles.title}>{current ? <Link to="/admin/requests" search={{ tab: kind, state: 'pending', projectId: item.projectId }}>{'operationId' in item ? item.operationId : item.fqdn}</Link>
      : <span>{'operationId' in item ? item.operationId : item.fqdn}</span>}</div><div className={styles.muted}>{item.project ? `${item.project.name} · ${item.project.slug}` : item.projectId}</div>
      {item.reason ? <p>{item.reason}</p> : null}</li>)}</ul> : null}
  </AdminTodoCard>;
}
