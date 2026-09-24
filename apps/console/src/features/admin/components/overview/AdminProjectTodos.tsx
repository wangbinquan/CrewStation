import { Link } from '@tanstack/react-router';
import { ProjectPageSchema } from '@crewstation/contracts';
import type { ManifestKind } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useAdminRead } from '../../../../shared/admin/useAdminRead';
import { useT } from '../../../../shared/lib/useT';
import { AdminTodoCard } from './AdminTodoCard';
import { INTEGRATION_KINDS } from '../../../../shared/admin/integrationKinds';
import styles from './AdminTodos.module.css';
import { ButtonLink } from '../../../../shared/ui/navigation/ButtonLink';

/**
 * 开通失败按归属拆成两张卡（2026-09-24 裁定）：数字人的入口去项目管理，接入容器的去「能力接入」，
 * 因为项目管理只列数字人；两张卡各读各的，互不影响。
 */
export function AdminProjectTodos({ integration = false }: { readonly integration?: boolean }) {
  const t = useT(), kind: ManifestKind[] = integration ? [...INTEGRATION_KINDS] : ['DigitalWorker'];
  const request = { state: 'failed' as const, kind, limit: 5 };
  const { query } = useAdminRead(queryKeys.adminProjectPage(request), async () => {
    const result = ProjectPageSchema.safeParse(await api.projects.page(request));
    if (!result.success || result.data.items.length > 5 || result.data.items.some((r) => r.role !== 'admin' || r.project.state !== 'failed' || !kind.includes(r.project.kind)) ||
      new Set(result.data.items.map((r) => r.project.id)).size !== result.data.items.length) throw new Error(t('admin.todo.invalid')); return result.data;
  });
  const items = [401, 403, 404].includes(query.error?.status ?? 0) ? [] : query.data?.items ?? [], current = !query.error;
  return <AdminTodoCard title={t(integration ? 'admin.todo.integrations' : 'admin.todo.projects')} pending={query.isPending} error={query.error}
    count={query.data ? items.length : undefined} more={!!query.data?.nextCursor}
    open={integration ? <ButtonLink to="/admin/capabilities" search={{ tab: 'integrations', state: 'failed' }}>{t('admin.todo.openIntegrations')}</ButtonLink>
      : <ButtonLink to="/admin/projects" search={{ state: 'failed' }}>{t('admin.todo.openProjects')}</ButtonLink>}>
    {items.length ? <ul className={styles.list}>{items.map(({ project: p, ownerName }) => <li key={p.id}><div className={styles.title}>{current ? <Link to="/admin/projects/$projectId/provisioning" params={{ projectId: p.id }}>{p.name}</Link> : p.name}</div>
      <div className={styles.muted}>{p.slug} · {ownerName ?? p.ownerUserId}</div>{p.message ? <p>{p.message}</p> : null}</li>)}</ul> : null}
  </AdminTodoCard>;
}
