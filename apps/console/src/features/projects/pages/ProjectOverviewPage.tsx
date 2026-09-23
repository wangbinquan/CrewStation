import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { PROJECT_PATHS } from '../../../shared/project/projectPaths';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { useProjectIdentity } from '../../../shared/project/useProjectIdentity';
import { ProjectStateBadge } from '../components/ProjectStateBadge';
import { useProjectSummary } from '../model/useProjectSummaries';
import { summaryIsFresh } from '../model/projectSummaryState';
import { ProjectSummaryActions } from '../components/summary/ProjectSummaryActions';
import { DeploymentTopologyCard } from '../components/summary/DeploymentTopologyCard';
import { ProjectNextStepBanner } from '../components/summary/ProjectNextStepBanner';
import { ProjectAttentionBanners } from '../components/summary/ProjectAttentionBanners';
import { ProjectRecentActivity } from '../components/summary/ProjectRecentActivity';
import { StatusCards } from '../components/summary/StatusCards';
import styles from '../components/summary/ProjectSummary.module.css';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';

/**
 * 项目概览一屏（RFC-020 D4）：页头（身份、主动作）→ 只在需要处理时出现的横幅 → 三张状态卡 → 形态 → 最近动态。
 * 成员、配额、归档都不在这里。2026-09-23 作者裁定：页头不再放仓库与两个应用地址——应用由版本卡上的「打开正式应用」「打开试用」
 * 打开，仓库链接在项目设置 → 项目信息卡；页头只在身份那一行末尾留「项目信息」入口。
 */
export function ProjectOverviewPage(): ReactElement {
  const t = useT();
  const { projectId, space } = useProjectScope();
  const identity = useProjectIdentity(projectId), { me, query } = useProjectSummary(projectId);
  const error = me.error ?? query.error, item = [401, 403, 404].includes(error?.status ?? 0) ? undefined : query.data;
  const project = item?.project ?? identity.data, available = !error && !query.isPending;
  const tester = item?.role === 'tester';
  const members = useApiQuery(queryKeys.members(projectId), () => api.projects.listMembers(projectId), { enabled: !!item && !tester });
  const names = new Map<string, string>((members.data?.items ?? []).map((member) => [member.userId as string, member.name]));
  if (me.data?.id && me.data.name) names.set(me.data.id, me.data.name);
  return (
    <>
      <PageHeader
        title={project?.name ?? t('projects.overview.title')}
        meta={project !== undefined ? <div>
          <code>{project.slug}</code><span>{t(`projects.kind.${project.kind}`)}</span><ProjectStateBadge state={project.state} />{item ? <span>{t(`projects.role.${item.role}`)} · {item.ownerName ?? project.ownerUserId}</span> : null}
          {item && !tester ? <ButtonLink size="small" to={PROJECT_PATHS[space].settings} params={{ projectId }} search={{ tab: 'info' }}>{t('projects.summary.projectInfo')}</ButtonLink> : null}
        </div> : undefined}
        actions={item ? <ProjectSummaryActions item={item} space={space} available={available} /> : undefined}
      />
      {project?.state === 'failed' && project.message !== undefined ? <p className={styles.failure} role="alert">{t('projects.list.failureLabel')}{project.message}</p> : null}
      <QueryStatus isPending={!error && (me.isPending || query.isPending)} error={error} loadingKey="projects.overview.loading" errorKey="projects.overview.error" />
      {error && item ? <ActionNote tone="neutral">{t('projects.summary.lastRead')}</ActionNote> : null}
      {item ? <div className={styles.stack}>
        {!summaryIsFresh(item) ? <ActionNote tone="neutral">{t('projects.summary.stale')}</ActionNote> : null}
        {available ? <><ProjectNextStepBanner item={item} space={space} /><ProjectAttentionBanners item={item} space={space} /></> : null}
        <StatusCards item={item} space={space} available={available} />
        {/* 形态与最近动态并排：1440×900 实测两者叠放时页面 1050px，超出一屏（WS-02）。 */}
        <div className={styles.bottom}>
          <DeploymentTopologyCard item={item} space={space} />
          {tester ? null : <ProjectRecentActivity item={item} space={space} names={names} />}
        </div>
      </div> : null}
    </>
  );
}
