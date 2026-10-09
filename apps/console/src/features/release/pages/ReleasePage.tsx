import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { RELEASE_PATHS } from '../../../shared/project/projectPaths';
import { parseReleaseSearch } from '../../../shared/project/releaseSearch';
import { api } from '../../../shared/api/client';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import { TagCard } from '../components/TagCard';
import { ReleaseTimeline } from '../components/ReleaseTimeline';
import { ReleaseHistory } from '../components/journey/ReleaseHistory';
import { DeploymentVersions } from '../components/DeploymentVersions';
import { useServiceOfProject } from '../model/useServiceOfProject';
import { useReleasePermissions } from '../model/journey/useReleasePermissions';
import { useReleaseActions } from '../model/useReleaseActions';
import { UnsavedChangesGuard } from '../../../shared/navigation/UnsavedChangesGuard';
import styles from './ReleasePage.module.css';

export function ReleasePage() {
  const { projectId } = useProjectScope();
  return <ReleaseWorkspace key={projectId} />;
}
function ReleaseWorkspace() {
  const t = useT(), { projectId, space } = useProjectScope(), navigate = useNavigate(), actions = useReleaseActions();
  const rawSearch = useSearch({ strict: false }), search = useMemo(() => parseReleaseSearch(rawSearch), [rawSearch]), permissions = useReleasePermissions(projectId);
  const { serviceId, isPending, error } = useServiceOfProject(projectId), [redeployId, setRedeployId] = useState<string>();
  const onSelect = (releaseId: string) => { void navigate({ to: RELEASE_PATHS[space].version, params: { projectId, releaseId }, search: { cursor: search.cursor, focus: releaseId } }); };
  useEffect(() => {
    if (search.source) { void navigate({ to: RELEASE_PATHS[space].publish, params: { projectId }, search, replace: true }); return; }
    if (search.release) { void navigate({ to: RELEASE_PATHS[space].version, params: { projectId, releaseId: search.release }, search: { ...search, release: undefined }, replace: true }); return; }
    // Historical switch-only links resolve the actual standby slot, never the latest release.
    let mounted = true;
    if (search.switch && serviceId) void api.services.listSlots(serviceId).then(slots => {
      const preview = slots.items.find(slot => slot.name === 'preview');
      if (mounted && preview?.releaseId) void navigate({ to: RELEASE_PATHS[space].version, params: { projectId, releaseId: preview.releaseId }, search: { switch: true }, replace: true });
    }).catch(() => undefined);
    return () => { mounted = false; };
  }, [navigate, projectId, space, search, serviceId]);
  return <>
    <UnsavedChangesGuard dirty={actions.dirty || !!actions.busy} scope={actions.dirtyDrafts.map(draft => t(`release.draft.${draft}`)).join(t('release.draft.separator')) || t('release.title')} allowNavigate={actions.allowNavigate} />
    <PageHeader title={t('release.title')} description={[t('release.wizard.overviewHint')]} actions={permissions.canPublish && serviceId && !error ? <ButtonLink variant="primary" to={RELEASE_PATHS[space].publish} params={{ projectId }} search={{ source: 'repository', cursor: search.cursor }}>{t('release.prepare.open')}</ButtonLink> : undefined} />
    <QueryStatus isPending={isPending} error={error} loadingKey="release.loading" errorKey="release.error" />
    {!serviceId && !isPending && !error ? <p>{t('release.noService')}</p> : null}
    {serviceId ? <div className={styles.stack}>
      <DeploymentVersions projectId={projectId} serviceId={serviceId} canSwitch={permissions.canSwitch && !error} actions={actions} onSelect={onSelect} onLaunch={releaseId => { void navigate({ to: RELEASE_PATHS[space].version, params: { projectId, releaseId }, search: { switch: true, cursor: search.cursor } }); }}
        onRedeployed={release => { if (release.journeyId) void navigate({ to: RELEASE_PATHS[space].journey, params: { projectId, journeyId: release.journeyId } }); }}
        redeployId={redeployId} onRedeploy={setRedeployId} onRedeployClose={() => setRedeployId(undefined)} />
      <ReleaseHistory serviceId={serviceId} userId={permissions.userId ?? ''} />
      <details><summary>{t('release.wizard.lifecycleHistory')}</summary><ReleaseTimeline projectId={projectId} serviceId={serviceId} onSelect={onSelect} lifecycleOnly /></details>
      <TagCard serviceId={serviceId} />
    </div> : null}
  </>;
}
