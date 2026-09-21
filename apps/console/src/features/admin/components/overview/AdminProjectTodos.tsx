import { Link } from '@tanstack/react-router';
import { ProjectPageSchema } from '@crewstation/contracts';
import type { ManifestKind } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useAdminRead } from '../../../../shared/admin/useAdminRead';
import { useT } from '../../../../shared/lib/useT';
import { AdminTodoCard } from './AdminTodoCard';
import { INTEGRATION_KINDS } from '../../model/integrationKinds';
import styles from './AdminTodos.module.css';

export function AdminProjectTodos() {
  const t = useT(), request = { state: 'failed' as const, kind: ['DigitalWorker', ...INTEGRATION_KINDS] as ManifestKind[], limit: 5 };
  const { query, refresh, refreshing } = useAdminRead(queryKeys.adminProjectPage(request), async () => {
    const result = ProjectPageSchema.safeParse(await api.projects.page(request));
    if (!result.success || result.data.items.length > 5 || result.data.items.some((r) => r.role !== 'admin' || r.project.state !== 'failed') ||
      new Set(result.data.items.map((r) => r.project.id)).size !== result.data.items.length) throw new Error(t('admin.todo.invalid')); return result.data;
  });
  const items = [401, 403, 404].includes(query.error?.status ?? 0) ? [] : query.data?.items ?? [], current = !refreshing && !query.error;
  return <AdminTodoCard title={t('admin.todo.projects')} refreshLabel={t('admin.todo.refresh.projects')} pending={query.isPending} error={query.error} busy={refreshing}
    count={query.data ? items.length : undefined} more={!!query.data?.nextCursor} checkedAt={query.dataUpdatedAt} refresh={refresh}
    open={<Link to="/admin/projects" search={{ state: 'failed' }}>{t('admin.todo.openProjects')}</Link>}>
    {items.length ? <ul className={styles.list}>{items.map(({ project: p, ownerName }) => <li key={p.id}><div className={styles.title}>{current ? <Link to="/admin/projects/$projectId/provisioning" params={{ projectId: p.id }}>{p.name}</Link> : p.name}</div>
      <div className={styles.muted}>{p.slug} · {ownerName ?? p.ownerUserId}</div>{p.message ? <p>{p.message}</p> : null}</li>)}</ul> : null}
  </AdminTodoCard>;
}
