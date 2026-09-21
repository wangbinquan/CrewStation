import { Link } from '@tanstack/react-router';
import { ProjectPageSchema, UserIdSchema } from '@crewstation/contracts';
import type { ManifestKind } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useAdminRead } from '../../../../shared/admin/useAdminRead';
import type { ProjectDirectorySearch } from '../../../../shared/admin/projectDirectorySearch';
import { useT } from '../../../../shared/lib/useT';
import { Card } from '../../../../shared/ui/Card';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { ProjectDirectoryFilters } from './ProjectDirectoryFilters';
import { ProjectDirectoryTable } from './ProjectDirectoryTable';
import { INTEGRATION_KINDS } from '../../model/integrationKinds';
import styles from './ProjectDirectory.module.css';

export function ProjectDirectory({ search, apply, integration = false }: {
  readonly search: ProjectDirectorySearch; readonly apply: (search: ProjectDirectorySearch) => void; readonly integration?: boolean;
}) {
  const t = useT(), kinds: ManifestKind[] = integration ? [...INTEGRATION_KINDS] : ['DigitalWorker', ...INTEGRATION_KINDS];
  const kind = search.kind && kinds.includes(search.kind) ? [search.kind] : kinds;
  const request = { ...search, ownerUserId: UserIdSchema.safeParse(search.ownerUserId).data, kind, limit: 20 };
  const { query, refresh, refreshing, userId } = useAdminRead(queryKeys.adminProjectPage(request), async () => {
    const result = ProjectPageSchema.safeParse(await api.projects.page(request));
    if (!result.success || result.data.items.length > 20 || result.data.items.some((row) => row.role !== 'admin' || !kind.includes(row.project.kind)) ||
      new Set(result.data.items.map((row) => row.project.id)).size !== result.data.items.length) throw new Error(t('admin.directory.invalid')); return result.data;
  });
  const items = [401, 403, 404].includes(query.error?.status ?? 0) ? [] : query.data?.items ?? [], settled = !query.error && !query.isPending;
  return <Card compact title={t(integration ? 'admin.integrations.title' : 'admin.directory.title')} footer={t('admin.directory.hint')}
    extra={<div className={styles.actions}><Button disabled={refreshing} onClick={() => void refresh()}>{t('admin.directory.refresh')}</Button>
      {!integration ? <Link to="/admin/projects/new" search={{ scope: 'digital-worker' }}>{t('projects.wizard.title.digital-worker')}</Link> : null}
      <Link to="/admin/projects/new" search={{ scope: 'integration' }}>{t('projects.wizard.title.integration')}</Link></div>}>
    <ProjectDirectoryFilters key={JSON.stringify(search)} search={search} items={items} userId={userId} integration={integration} busy={refreshing} apply={apply} />
    <QueryStatus isPending={query.isPending} error={query.error} isEmpty={items.length === 0} emptyTitle={t('admin.directory.empty')} emptyDescription={t('admin.directory.emptyHint')} />
    {query.error && items.length ? <ActionNote tone="neutral">{t('admin.directory.lastRead')}</ActionNote> : null}
    {items.length ? <ProjectDirectoryTable items={items} available={settled && !refreshing} /> : null}
    <div className={styles.toolbar}><span className={styles.muted}>{settled ? t('admin.directory.count', { count: items.length }) : t('admin.directory.countUnknown')}</span>
      <div className={styles.actions}>{search.cursor ? <Button disabled={refreshing} onClick={() => apply({ ...search, cursor: undefined })}>{t('admin.directory.first')}</Button> : null}
        <Button disabled={refreshing || !!query.error || !query.data?.nextCursor} onClick={() => apply({ ...search, cursor: query.data?.nextCursor })}>{t('admin.directory.next')}</Button></div></div>
  </Card>;
}
