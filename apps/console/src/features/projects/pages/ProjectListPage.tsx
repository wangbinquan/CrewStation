import type { ReactElement } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Button } from '../../../shared/ui/Button';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { ProjectSummaryTable } from '../components/summary/ProjectSummaryTable';
import { ProjectListFilters } from '../components/summary/ProjectListFilters';
import { parseProjectListSearch } from '../model/projectListSearch';
import { useProjectSummaries } from '../model/useProjectSummaries';
import styles from '../components/summary/ProjectSummary.module.css';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';

/**
 * 首页：管理员看全部项目并可代建，成员只看自己参与的项目。
 * 只列数字人（RFC-002）：接入容器是管理员建的平台项目，归平台管理空间，不占租户的列表。
 */
export function ProjectListPage(): ReactElement {
  const t = useT(), navigate = useNavigate(), search = parseProjectListSearch(useSearch({ strict: false }));
  const { me, query } = useProjectSummaries(search);
  const error = me.error ?? query.error, pending = !error && (me.isPending || query.isPending);
  const items = [401, 403, 404].includes(error?.status ?? 0) ? [] : query.data?.items ?? [];
  const settled = !pending && !error, filtered = !!(search.q || search.state || search.ownerUserId || search.cursor);

  return (
    <>
      <PageHeader title={t('projects.list.title')} description={t('projects.summary.listHint')}
        actions={<ButtonLink variant="primary" to="/projects/new">{t('projects.self.title')}</ButtonLink>} />
      <Card compact title={t('projects.list.cardTitle')} footer={t('projects.summary.filterHint')}>
        <ProjectListFilters key={JSON.stringify(search)} search={search} items={items} userId={me.data?.id}
          apply={(next) => { void navigate({ to: '/projects', search: next }); }} />
        <QueryStatus isPending={pending} error={error} loadingKey="projects.list.loading" errorKey="projects.list.error" />
        {error && items.length > 0 ? <ActionNote tone="neutral">{t('projects.summary.lastRead')}</ActionNote> : null}
        {settled && items.length === 0 ? <EmptyState title={t(filtered ? 'projects.summary.noMatches' : 'projects.list.emptyTitle')} description={t(filtered ? 'projects.summary.noMatchesHint' : 'projects.list.emptyDescription')}
          action={filtered ? undefined : <ButtonLink to="/projects/new">{t('projects.self.title')}</ButtonLink>} /> : null}
        {items.length > 0 ? <ProjectSummaryTable items={items} available={!error && !pending} /> : null}
        <div className={styles.toolbar}><span className={styles.muted}>{settled ? t('projects.summary.pageSize', { count: items.length }) : t('projects.summary.countUnknown')}</span>
          <div className={styles.actions}>{search.cursor ? <Button onClick={() => void navigate({ to: '/projects', search: { ...search, cursor: undefined } })}>{t('projects.summary.firstPage')}</Button> : null}
            <Button disabled={!!error || !query.data?.nextCursor} onClick={() => void navigate({ to: '/projects', search: { ...search, cursor: query.data?.nextCursor } })}>{t('projects.summary.nextPage')}</Button></div></div>
      </Card>
    </>
  );
}
