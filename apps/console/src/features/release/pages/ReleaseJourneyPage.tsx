import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ReleaseJourneyDetailSchema } from '@crewstation/contracts';
import type { ReleaseJourneyDetail } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { useDateText } from '../../../shared/lib/useDateText';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { PROJECT_PATHS, RELEASE_PATHS } from '../../../shared/project/projectPaths';
import { parseReleaseSearch } from '../../../shared/project/releaseSearch';
import { Button } from '../../../shared/ui/Button';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { FormField } from '../../../shared/ui/FormField';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { CopyButton } from '../../../shared/ui/clipboard/CopyButton';
import { StageProgress } from '../../../shared/ui/progress/StageProgress';
import { ButtonLink, ExternalButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import { UnsavedChangesGuard } from '../../../shared/navigation/UnsavedChangesGuard';
import { useReleasePermissions } from '../model/journey/useReleasePermissions';
import { useJourneyActions } from '../model/journey/useJourneyActions';
import { journeyEnded, journeyStep, stageProgress } from '../model/journey/view';
import { WizardFrame } from '../components/journey/WizardFrame';
import { JourneyLogs } from '../components/journey/JourneyLogs';
import styles from '../components/journey/WizardFrame.module.css';

export function ReleaseJourneyPage() {
  const { projectId } = useProjectScope(), { journeyId = '' } = useParams({ strict: false }), t = useT();
  const permissions = useReleasePermissions(projectId);
  const query = useApiQuery(['release-journey', journeyId], async () => {
    const detail = ReleaseJourneyDetailSchema.parse(await api.services.getReleaseJourney(journeyId));
    if (detail.id !== journeyId || detail.snapshot.projectId !== projectId) throw new Error(t('release.detail.mismatch'));
    return detail;
  }, { refetchIntervalMs: detail => !detail || !journeyEnded(detail.status) ? detail?.trafficSwitch?.handoff ? 3000 : 5000 : undefined, refetchOnWindowFocus: true });
  return <>{!query.data || !permissions.userId ? <QueryStatus isPending={query.isPending || permissions.me.isPending} error={query.error ?? permissions.me.error} />
    : <Journey key={`${journeyId}:${permissions.userId}`} detail={query.data} refresh={query.refetch} error={query.error} />}</>;
}
function Journey({ detail, refresh, error }: { readonly detail: ReleaseJourneyDetail; readonly refresh: () => Promise<unknown>; readonly error: unknown }) {
  const t = useT(), date = useDateText(), { projectId, space } = useProjectScope(), permissions = useReleasePermissions(projectId);
  const search = parseReleaseSearch(useSearch({ strict: false })), navigate = useNavigate(), current = journeyStep(detail), ended = journeyEnded(detail.status);
  const step = ended ? search.step ?? current : Math.min(search.step ?? current, current);
  const actions = useJourneyActions(detail, { projectId, space, userId: permissions.userId ?? '', canPublish: permissions.canPublish, canSwitch: permissions.canSwitch }, refresh, error);
  const onStep = (next: number | undefined) => { void navigate({ to: RELEASE_PATHS[space].journey, params: { projectId, journeyId: detail.id }, search: { ...search, step: next }, replace: true }); };
  const preview = detail.slots.find(slot => slot.name === 'preview' && slot.releaseId === detail.snapshot.releaseId && slot.state === 'ready');
  const production = detail.slots.find(slot => slot.name === 'prod');
  const footer = <>
    {step !== current && !ended ? <Button variant="primary" onClick={() => onStep(undefined)}>{t('release.wizard.currentStep')}</Button>
      : current === 2 && !ended ? <Button variant="primary" disabled={actions.busy || !!error || !permissions.canPublish || !detail.continuation.canVerify} onClick={() => void actions.verify()}>{t('release.wizard.verify')}</Button>
        : current === 3 && !ended && !detail.trafficSwitch && !actions.intent ? <Button variant="primary" disabled={actions.busy || !!error || !permissions.canSwitch || !detail.continuation.canLaunch || actions.stale} onClick={() => void actions.launch()}>{t('release.wizard.launch', { tag: detail.snapshot.tag })}</Button> : null}
    {actions.intent && !detail.trafficSwitch ? <Button disabled={actions.busy} onClick={() => void refresh()}>{t('release.wizard.readLaunch')}</Button> : null}
    {ended && production?.releaseId === detail.snapshot.releaseId && production.state === 'ready' ? <ExternalButtonLink variant="primary" href={`//${production.host}`}>{t('slot.open.prod')}</ExternalButtonLink> : null}
    <ButtonLink variant="ghost" to={PROJECT_PATHS[space].release} params={{ projectId }} search={{ cursor: search.cursor, filter: search.filter, focus: search.focus }}>{t(ended ? 'release.wizard.back' : 'release.wizard.later')}</ButtonLink>
    {ended && permissions.canPublish ? <ButtonLink to={RELEASE_PATHS[space].publish} params={{ projectId }} search={{ source: 'repository' }}>{t('release.prepare.open')}</ButtonLink> : null}
    {ended && permissions.canSwitch && detail.release.redeployable ? <ButtonLink to={RELEASE_PATHS[space].version} params={{ projectId, releaseId: detail.snapshot.releaseId }} search={{ cursor: search.cursor, filter: search.filter, focus: search.focus }}>{t('release.redeploy.fromDetail')}</ButtonLink> : null}
  </>;
  return <WizardFrame step={step} current={current} onStep={onStep} history={ended} footer={footer} backSearch={{ cursor: search.cursor, filter: search.filter, focus: search.focus }}
    summary={<><strong>{detail.snapshot.tag}</strong><code>{detail.snapshot.commitSha}</code><span>{detail.snapshot.branch}</span><span>{t(`release.wizard.status.${detail.status}`)}</span></>}>
    <UnsavedChangesGuard dirty={!!actions.note || !!actions.reason} scope={t('release.wizard.unsavedNote')} allowNavigate={(from, to) => from.pathname === to.pathname} />
    {error ? <QueryStatus isPending={false} error={error} /> : null}
    {ended ? <ActionNote tone={detail.status === 'succeeded' ? 'success' : detail.status === 'failed' ? 'error' : 'neutral'}>{t(`release.wizard.result.${detail.status}`)} {t('release.wizard.immutableHistory')}</ActionNote> : null}
    {step === 0 ? <DefinitionList items={[{ label: t('release.prepare.step.source'), value: t(`release.wizard.source.${detail.snapshot.source.kind}`) }, { label: t('release.prepare.message'), value: detail.snapshot.message ?? '—' }, { label: t('release.wizard.initiator'), value: detail.snapshot.actorUserId }, { label: t('release.wizard.started'), value: date(detail.snapshot.startedAt) }]} /> : null}
    <StageProgress progress={stageProgress(detail.stages, step, detail.status)} label={stage => t(`release.wizard.stage.${stage.kind}`)} />
    {step === 1 ? <JourneyLogs releaseId={detail.snapshot.releaseId} active={!ended} /> : null}
    {step === 2 ? <>
      <p>{t('release.wizard.verifyHint')}</p>
      {preview && !ended ? <ExternalButtonLink variant="primary" href={`//${preview.host}`}>{t('release.wizard.openPreview')}</ExternalButtonLink> : null}
      {detail.verification ? <ActionNote tone="success">{t('release.wizard.verified', { actor: detail.verification.actorUserId, time: date(detail.verification.at) })}{detail.verification.note ? ` · ${detail.verification.note}` : ''}</ActionNote>
        : !ended ? <FormField label={t('release.wizard.verifyNote')}><textarea rows={2} maxLength={500} value={actions.note} disabled={actions.busy || !permissions.canPublish} onChange={event => actions.setNote(event.target.value)} /></FormField> : <p>{t('ui.progress.state.unknown')}</p>}
    </> : null}
    {step === 3 ? <>
      <DefinitionList items={[{ label: t('release.wizard.currentProduction'), value: production?.tag ?? t('slot.empty') }, { label: t('release.wizard.target'), value: detail.snapshot.tag }, { label: t('release.prepare.sha'), value: <code>{detail.snapshot.commitSha}</code> }]} />
      {detail.trafficSwitch ? <DefinitionList items={[{ label: t('release.wizard.previousProduction'), value: detail.trafficSwitch.previousReleaseId ?? t('slot.empty') }, { label: t('release.wizard.launchActor'), value: detail.trafficSwitch.actorUserId }, { label: t('release.traffic.reason'), value: detail.trafficSwitch.reason ?? '—' }]} /> : null}
      {detail.trafficSwitch ? <ActionNote tone={detail.status === 'succeeded' ? 'success' : 'neutral'}>{t(detail.status === 'succeeded' ? 'release.wizard.result.succeeded' : detail.trafficSwitch.handoff ? `release.handoff.${detail.trafficSwitch.handoff.stage}` : 'release.wizard.routePending')} {detail.trafficSwitch.handoff?.message}</ActionNote>
        : actions.intent ? <ActionNote tone="neutral">{t('release.wizard.launchUnknown')}</ActionNote> : !ended ? <>
          <p>{t('release.wizard.confirmHint')}</p>
          {!permissions.canSwitch ? <ActionNote tone="neutral">{t('release.wizard.ownerHandoff')} <CopyButton value={window.location.href} /></ActionNote> : null}
          <FormField label={t('release.traffic.reason')}><textarea rows={2} maxLength={500} value={actions.reason} disabled={actions.busy || !permissions.canSwitch} onChange={event => actions.setReason(event.target.value)} /></FormField>
          {actions.stale && detail.continuation.canLaunch ? <ActionNote tone="neutral">{t('release.wizard.targetChanged')} <Button onClick={actions.recheck}>{t('release.wizard.recheck')}</Button></ActionNote> : null}
        </> : null}
    </> : null}
    {step === 4 ? <p>{t('release.wizard.completedHint')}</p> : null}
    {!ended && detail.continuation.reason && !detail.trafficSwitch ? <ActionNote tone="neutral">{detail.continuation.reason}</ActionNote> : null}
    {actions.error ? <ActionNote tone="error">{actions.error}</ActionNote> : null}
    <details><summary>{t('release.wizard.events')}</summary><ol className={styles.events}>{detail.events.map(event => <li key={event.id}><time dateTime={event.at}>{date(event.at)}</time><span>{t(`release.wizard.stage.${event.stage}`)} · {t(`ui.progress.state.${event.state}`)}</span>{event.reason ? <span>{event.reason}</span> : null}</li>)}</ol></details>
  </WizardFrame>;
}
