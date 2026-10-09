import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ReleaseDtoSchema, ReleaseJourneyHistorySchema } from '@crewstation/contracts';
import type { ReleaseDto, ReleaseJourneyHistory } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { useDateText } from '../../../shared/lib/useDateText';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { PROJECT_PATHS, RELEASE_PATHS } from '../../../shared/project/projectPaths';
import { parseReleaseSearch } from '../../../shared/project/releaseSearch';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { Button } from '../../../shared/ui/Button';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import { Card } from '../../../shared/ui/Card';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { StageProgress } from '../../../shared/ui/progress/StageProgress';
import { useServiceOfProject } from '../model/useServiceOfProject';
import { useReleasePermissions } from '../model/journey/useReleasePermissions';
import { journeyEnded, stageProgress } from '../model/journey/view';
import { useReleaseActions } from '../model/useReleaseActions';
import { useSlotLifecycle } from '../model/useSlotLifecycle';
import { RedeployDialog } from '../components/RedeployDialog';
import { LegacyLaunch } from '../components/journey/LegacyLaunch';
import { JourneyLogs } from '../components/journey/JourneyLogs';
import { WizardFrame } from '../components/journey/WizardFrame';
import styles from './ReleasePage.module.css';

export function ReleaseVersionPage() {
  const { projectId } = useProjectScope(), { releaseId = '' } = useParams({ strict: false }), service = useServiceOfProject(projectId), t = useT();
  const query = useApiQuery(['release-version-history', releaseId, service.serviceId], async () => {
    const release = ReleaseDtoSchema.parse(await api.services.getRelease(releaseId));
    if (release.id !== releaseId || release.serviceId !== service.serviceId) throw new Error(t('release.detail.mismatch'));
    const history = ReleaseJourneyHistorySchema.parse(await api.services.getReleaseJourneyHistory(releaseId));
    return { release, history };
  }, { enabled: !!service.serviceId, refetchIntervalMs: 5000 });
  return <>{!query.data ? <QueryStatus isPending={service.isPending || query.isPending} error={service.error ?? query.error} />
    : <Version key={releaseId} {...query.data} refresh={query.refetch} error={query.error ?? service.error} />}</>;
}
function Version({ release, history, refresh, error }: { readonly release: ReleaseDto; readonly history: ReleaseJourneyHistory; readonly refresh: () => Promise<unknown>; readonly error: unknown }) {
  const t = useT(), date = useDateText(), { projectId, space } = useProjectScope(), permissions = useReleasePermissions(projectId), navigate = useNavigate();
  const search = parseReleaseSearch(useSearch({ strict: false })), actions = useReleaseActions(), [redeploy, setRedeploy] = useState(false);
  const slots = useApiQuery(queryKeys.slots(release.serviceId), () => api.services.listSlots(release.serviceId), { refetchIntervalMs: 5000 });
  const onAccepted = (journeyId: string) => { void navigate({ to: RELEASE_PATHS[space].journey, params: { projectId, journeyId }, search: { cursor: search.cursor, filter: search.filter, focus: search.focus }, replace: true }); };
  const lifecycle = useSlotLifecycle(projectId, release.serviceId, actions, accepted => { if (accepted.journeyId) onAccepted(accepted.journeyId); });
  const active = history.journeys.filter(journey => !journeyEnded(journey.status)), preview = slots.data?.items.find(slot => slot.name === 'preview');
  const blocked = !!error || !!slots.error || !slots.data;
  const currentJourney = active.find(journey => journey.id === release.journeyId)?.id;
  useEffect(() => {
    if (search.switch && currentJourney && !error) void navigate({ to: RELEASE_PATHS[space].journey, params: { projectId, journeyId: currentJourney }, search: { cursor: search.cursor, filter: search.filter, focus: search.focus }, replace: true });
  }, [search.switch, search.cursor, search.filter, search.focus, currentJourney, error, navigate, projectId, space]);
  return <div className={styles.stack}>
    <ButtonLink variant="ghost" to={PROJECT_PATHS[space].release} params={{ projectId }} search={{ cursor: search.cursor, filter: search.filter, focus: search.focus }} resetScroll={!search.focus}>{t('release.wizard.back')}</ButtonLink>
    <PageHeader title={`${t('release.detail.title')} · ${release.tag}`} />
    <QueryStatus isPending={slots.isPending} error={error ?? slots.error} />
    <DefinitionList items={[{ label: t('release.prepare.sha'), value: <code>{release.commitSha}</code> }, { label: t('release.publish.branch'), value: release.branch }, { label: t('release.history.columnStatus'), value: t(`release.status.${release.status}`) }]} />
    {release.message ? <ActionNote tone={release.status === 'failed' ? 'error' : 'neutral'}>{release.message}</ActionNote> : null}
    <Card title={t('release.wizard.versionJourneys')} actions={permissions.canSwitch && release.redeployable ? <Button disabled={blocked || !!actions.busy} onClick={() => setRedeploy(true)}>{t('release.redeploy.fromDetail')}</Button> : undefined}>
      {history.journeys.map(journey => <p key={journey.id}><ButtonLink to={RELEASE_PATHS[space].journey} params={{ projectId, journeyId: journey.id }} search={{ cursor: search.cursor, filter: search.filter, focus: search.focus }}>{t(journeyEnded(journey.status) ? 'release.wizard.view' : 'release.wizard.continue')} · {t(`release.wizard.kind.${journey.snapshot.kind}`)}</ButtonLink> {t(`release.wizard.status.${journey.status}`)} · {date(journey.snapshot.startedAt)}</p>)}
      {active.length ? <p>{t('release.wizard.existingJourney')}</p> : null}
    </Card>
    {history.legacy ? <LegacyHistory history={history} /> : null}
    {!active.length && preview?.releaseId === release.id && permissions.userId ? <LegacyLaunch key={permissions.userId} release={release} slots={slots.data?.items ?? []} userId={permissions.userId} space={space} projectId={projectId} canSwitch={permissions.canSwitch && !blocked} refresh={refresh} onAccepted={onAccepted} /> : null}
    <JourneyLogs releaseId={release.id} active={active.length > 0} />
    <details><summary>{t('release.wizard.lifecycleHistory')}</summary>
      {history.trafficSwitches.map(event => <p key={event.id}>{date(event.createdAt)} · {t('release.wizard.kind.promote')} · <code>{event.actorUserId}</code> · {event.reason}</p>)}
      {history.slotEvents.map(event => <p key={event.id}>{date(event.at)} · {t(`release.wizard.lifecycle.${event.kind}`)}</p>)}
    </details>
    {redeploy ? <RedeployDialog release={release} releases={[release]} standby={preview} lifecycle={lifecycle} blocked={blocked || !!actions.busy} onClose={() => setRedeploy(false)} /> : null}
    {lifecycle.error ? <ActionNote tone="error">{lifecycle.error}</ActionNote> : null}
  </div>;
}
function LegacyHistory({ history }: { readonly history: ReleaseJourneyHistory }) {
  const t = useT(), [step, setStep] = useState(1);
  return <WizardFrame step={step} current={1} onStep={setStep} history embedded footer={<span>{t('release.wizard.legacyHint')}</span>}>
    <ActionNote tone="neutral">{t('release.wizard.legacyHint')}</ActionNote>
    <StageProgress progress={stageProgress(history.legacy!.stages, step, 'legacy')} label={stage => t(`release.wizard.stage.${stage.kind}`)} />
  </WizardFrame>;
}
