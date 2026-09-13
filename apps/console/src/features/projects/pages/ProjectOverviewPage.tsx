import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { PROJECT_PATHS } from '../../../shared/project/projectPaths';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { useProjectIdentity } from '../../../shared/project/useProjectIdentity';
import { ProjectStateBadge } from '../components/ProjectStateBadge';
import { useProjectSummary } from '../model/useProjectSummaries';
import { summaryIsFresh } from '../model/projectSummaryState';
import { ProjectSummaryActions } from '../components/summary/ProjectSummaryActions';
import { DeploymentFact, DevelopmentFact, HealthFact, SummaryChecked } from '../components/summary/SummaryFacts';
import { ProjectRecentActivity } from '../components/summary/ProjectRecentActivity';
import { ProjectSummaryAttention } from '../components/summary/ProjectSummaryAttention';
import styles from '../components/summary/ProjectSummary.module.css';

/** 项目概览保留运行版本，成员、仓库与资源通过设置入口查看。 */
export function ProjectOverviewPage(): ReactElement {
  const t = useT();
  const { projectId, space } = useProjectScope();
  const identity = useProjectIdentity(projectId), { me, query, refresh } = useProjectSummary(projectId);
  const error = me.error ?? query.error, item = [401, 403, 404].includes(error?.status ?? 0) ? undefined : query.data;
  const project = item?.project ?? identity.data, available = !error && !query.isPending && !me.isFetching && !query.isFetching;
  return (
    <>
      <PageHeader
        title={project?.name ?? t('projects.overview.title')}
        actions={
          <Button disabled={me.isFetching || query.isFetching} onClick={() => void refresh()}>{t('projects.summary.refreshOverview')}</Button>
        }
      />
      {project !== undefined ? (
        <div className={styles.toolbar}>
          <code>{project.slug}</code>
          <span>{t(`projects.kind.${project.kind}`)}</span>
          <ProjectStateBadge state={project.state} />
          {item ? <span>{t(`projects.role.${item.role}`)} · {item.ownerName ?? project.ownerUserId}</span> : null}
        </div>
      ) : null}
      {project?.state === 'failed' && project.message !== undefined ? (
        <p className={styles.failure} role="alert">
          {t('projects.list.failureLabel')}
          {project.message}
        </p>
      ) : null}
      <QueryStatus isPending={!error && (me.isPending || query.isPending)} error={error} loadingKey="projects.overview.loading" errorKey="projects.overview.error" />
      {error && item ? <ActionNote tone="neutral">{t('projects.summary.lastRead')}</ActionNote> : null}
      {item ? <div className={styles.stack}>
        <ProjectSummaryActions item={item} space={space} available={available} />
        {!summaryIsFresh(item) ? <ActionNote tone="neutral">{t('projects.summary.stale')}</ActionNote> : null}
        <div className={styles.grid}><Card compact title={t('projects.summary.development')}><DevelopmentFact item={item} /><SummaryChecked checkedAt={item.development.checkedAt} /></Card>
          <Card compact title={t('projects.summary.preview')}><DeploymentFact item={item} name="preview" canOpen={available && summaryIsFresh(item)} /><SummaryChecked checkedAt={item.slots.checkedAt} /></Card>
          <Card compact title={t('projects.summary.prod')}><DeploymentFact item={item} name="prod" canOpen={available && summaryIsFresh(item)} /><SummaryChecked checkedAt={item.slots.checkedAt} /></Card></div>
        <Card compact title={t('projects.summary.health')} extra={<Link to={PROJECT_PATHS[space].operations} params={{ projectId }} search={{ tab: 'health' }}>{t('projects.summary.diagnostics')}</Link>}>
          <HealthFact item={item} /><SummaryChecked checkedAt={item.health.checkedAt} /><p className={styles.muted}>{t('projects.summary.dataHint')}</p></Card>
        {available ? <ProjectSummaryAttention item={item} space={space} /> : null}
        <ProjectRecentActivity item={item} space={space} />
      </div> : null}
      <div className={styles.toolbar}>
        <Link to={PROJECT_PATHS[space].release} params={{ projectId }}>{t('projects.overview.goRelease')}</Link>
        <Link to={PROJECT_PATHS[space].settings} params={{ projectId }} search={{ tab: 'members' }}>{t('settings.tab.members')}</Link>
        <Link to={PROJECT_PATHS[space].settings} params={{ projectId }} search={{ tab: 'repository' }}>{t('settings.tab.repository')}</Link>
        <Link to={PROJECT_PATHS[space].settings} params={{ projectId }} search={{ tab: 'resources' }}>{t('settings.tab.resources')}</Link>
      </div>
    </>
  );
}
