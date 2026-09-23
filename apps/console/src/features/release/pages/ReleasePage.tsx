import { useState } from 'react';
import type { ReactElement } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { PROJECT_PATHS } from '../../../shared/project/projectPaths';
import { parseReleaseSearch } from '../../../shared/project/releaseSearch';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Button } from '../../../shared/ui/Button';
import { PublishDialog } from '../components/PublishDialog';
import { TagCard } from '../components/TagCard';
import { ReleaseTimeline } from '../components/ReleaseTimeline';
import { SelectedRelease } from '../components/SelectedRelease';
import { DeploymentVersions } from '../components/DeploymentVersions';
import { useServiceOfProject } from '../model/useServiceOfProject';
import { usePublishDraft } from '../model/usePublishDraft';
import { useReleaseActions } from '../model/useReleaseActions';
import { UnsavedChangesGuard } from '../../../shared/navigation/UnsavedChangesGuard';
import styles from './ReleasePage.module.css';

/**
 * 发布页：两张部署版本卡（上线／回退在待验证卡上）、发布准备、合并的发布记录时间线与标签列表（RFC-020 §6）；
 * 正式版本的维护、待验证版本的下线与推迟、从发布记录重新部署（RFC-021）。发布准备、上线／回退、维护与重新部署都是弹窗（2026-09-23）。
 */
export function ReleasePage(): ReactElement {
  const { projectId } = useProjectScope();
  return <ReleaseWorkspace key={projectId} />;
}

function ReleaseWorkspace(): ReactElement {
  const t = useT();
  const actions = useReleaseActions(), publishDraft = usePublishDraft(actions);
  const { projectId, space } = useProjectScope(), navigate = useNavigate();
  const search = parseReleaseSearch(useSearch({ strict: false }));
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const canPublish = !me.error && !!me.data && (me.data.isAdmin || me.data.memberships?.some((member) => member.projectId === projectId && ['owner', 'developer'].includes(member.role)) === true);
  const canSwitch = !me.error && !!me.data && (me.data.isAdmin || me.data.memberships?.some((member) => member.projectId === projectId && member.role === 'owner') === true);
  const updateSearch = (next: typeof search) => void navigate({ to: PROJECT_PATHS[space].release, params: { projectId }, search: next });
  const { serviceId, isPending, error } = useServiceOfProject(projectId);
  // 重新部署的确认面板挂在版本卡下；时间线、发布详情与已下线的待验证卡都从这里发起。
  const [redeployId, setRedeployId] = useState<string>(), redeploy = canSwitch && !error ? setRedeployId : undefined;
  // 离开确认写明哪几份草稿会丢（2026-09-23 裁定：草稿关弹窗不丢，离开页面才丢）。
  const scope = actions.dirtyDrafts.map((draft) => t(`release.draft.${draft}`)).join(t('release.draft.separator')) || t('release.title');
  return (
    <>
      <UnsavedChangesGuard dirty={actions.dirty || !!actions.busy} scope={scope} allowNavigate={actions.allowNavigate} />
      <PageHeader title={t('release.title')} description={[t('release.line1')]} actions={<Button variant="primary" disabled={!canPublish || !serviceId || !!error} onClick={() => updateSearch({ ...search, source: search.source ?? 'repository' })}>{t('release.prepare.open')}</Button>} />
      <QueryStatus isPending={isPending} error={error} loadingKey="release.loading" errorKey="release.error" />
      {serviceId === undefined && !isPending && !error ? <p className={styles.note}>{t('release.noService')}</p> : null}
      {serviceId !== undefined ? (
        <div className={styles.stack}>
          <DeploymentVersions projectId={projectId} serviceId={serviceId} canSwitch={canSwitch && !error} actions={actions} autoCheck={!!search.switch} onSelect={(release) => updateSearch({ ...search, release })}
            redeployId={redeployId} onRedeploy={setRedeployId} onRedeployClose={() => setRedeployId(undefined)} />
          {search.source ? <PublishDialog serviceId={serviceId} projectId={projectId} source={search.source} canPublish={canPublish && !error} actions={actions} draft={publishDraft} onSource={(source) => updateSearch({ ...search, source })} onClose={() => updateSearch({ release: search.release })} onAccepted={(release) => updateSearch({ release: release.id })} /> : null}
          {search.release ? <SelectedRelease key={search.release} releaseId={search.release} serviceId={serviceId} {...(redeploy ? { onRedeploy: redeploy } : {})} /> : null}
          <ReleaseTimeline projectId={projectId} serviceId={serviceId} onSelect={(release) => updateSearch({ ...search, release })} {...(redeploy ? { onRedeploy: redeploy } : {})} />
          <TagCard serviceId={serviceId} />
        </div>
      ) : null}
    </>
  );
}
