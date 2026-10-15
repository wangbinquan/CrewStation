import { useState } from 'react';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { PROJECT_PATHS, RELEASE_PATHS } from '../../../shared/project/projectPaths';
import { useT } from '../../../shared/lib/useT';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { Card } from '../../../shared/ui/Card';
import { Stack } from '../../../shared/ui/Stack';
import { Button } from '../../../shared/ui/Button';
import { ButtonLink, ExternalButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { JourneySteps } from '../../../shared/ui/progress/JourneySteps';
import { useProjectSummary } from '../model/useProjectSummaries';
import { firstDeliveryState } from '../model/delivery/firstDelivery';
import { ProjectProvisioningPage } from './ProjectProvisioningPage';

export function FirstDeliveryPage() {
  const t = useT(), { projectId, space } = useProjectScope(), { me, query } = useProjectSummary(projectId), [diagnostics, setDiagnostics] = useState(false);
  const error = me.error ?? query.error, item = error ? undefined : query.data;
  const state = item ? firstDeliveryState(item) : undefined, params = { projectId };
  const releaseId = state?.pendingRelease?.id ?? state?.preview?.releaseId;
  return <Stack>
    <PageHeader title={t('projects.delivery.title')} description={t('projects.delivery.subtitle', { name: item?.project.name ?? '' })} />
    <JourneySteps label={t('projects.delivery.title')} labels={['create', 'environment', 'develop', 'verify', 'deliver'].map(key => t(`projects.delivery.step.${key}`))} current={state?.current ?? 1} />
    <QueryStatus isPending={me.isPending || query.isPending} error={error} />
    {item && state ? <Card stacked title={t(`projects.delivery.stage.${state.stage}`)} actions={<>
      {item.project.state === 'active' && state.fresh ? releaseId && !state.production ? <ButtonLink variant="primary" to={RELEASE_PATHS[space].version} params={{ projectId, releaseId }} search={{ switch: true }}>{t(state.latest?.status === 'failed' ? 'projects.delivery.repairRelease' : 'projects.delivery.verify')}</ButtonLink>
        : <ButtonLink variant="primary" to={PROJECT_PATHS[space].development} params={params} search={{ view: 'guided' }}>{t('projects.delivery.develop')}</ButtonLink> : null}
      {item.project.state === 'active' && state.fresh && releaseId && !state.production ? <ButtonLink to={PROJECT_PATHS[space].development} params={params} search={{ view: 'guided' }}>{t('projects.delivery.customize')}</ButtonLink> : null}
      <Button onClick={() => setDiagnostics(true)}>{t('projects.delivery.diagnostics')}</Button>
      <ButtonLink to={PROJECT_PATHS[space].overview} params={params}>{t('nav.overview')}</ButtonLink>
    </>}>
      <p>{t(`projects.delivery.hint.${state.stage}`)}</p>
      {state.pendingRelease && !state.production ? <p>{state.pendingRelease.tag} · {t(`release.status.${state.pendingRelease.status}`)}</p> : null}
      {!state.fresh || !state.slotsKnown ? <ActionNote tone="neutral">{t('projects.summary.unknown')}</ActionNote> : null}
      {item.project.message ? <ActionNote tone="error">{item.project.message}</ActionNote> : null}
      {state.latest?.message ? <ActionNote tone={state.latest.status === 'failed' ? 'error' : 'neutral'}>{state.latest.message}</ActionNote> : null}
      {state.production ? <p><strong>{state.production.tag}</strong> <code>{state.production.commitSha}</code> {safeHost(state.production.host) ? <ExternalButtonLink href={`//${state.production.host}`}>{t('slot.open.prod')}</ExternalButtonLink> : null}</p> : null}
      <ActionNote tone="neutral">{t('projects.delivery.dataBoundary')}</ActionNote>
    </Card> : null}
    <p>{t('projects.delivery.resumeHint')}</p>
    {diagnostics ? <Dialog title={t('projects.delivery.diagnostics')} size="large" onClose={() => setDiagnostics(false)}><ProjectProvisioningPage projectId={projectId} /></Dialog> : null}
  </Stack>;
}
function safeHost(host: string) { return /^[a-z0-9][a-z0-9.-]*(?::\d+)?$/i.test(host); }
