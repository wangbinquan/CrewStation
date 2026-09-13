import { useEffect, useId, useRef } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery, errorMessage } from '../../../shared/api/useApi';
import { usePollingRefetch } from '../../../shared/lib/usePollingRefetch';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Button } from '../../../shared/ui/Button';
import { ConfirmationPanel } from '../../../shared/ui/ConfirmationPanel';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { FormField } from '../../../shared/ui/FormField';
import { deployedVersions, slotCanOpen, trafficSnapshotMatches } from '../model/deployedVersions';
import type { DeployedVersions } from '../model/deployedVersions';
import type { ReleaseActions } from '../model/useReleaseActions';
import { useTrafficConfirmation } from '../model/useTrafficConfirmation';
import { isInFlight } from '../model/releaseStatus';
import { DeployedVersionCard } from './DeployedVersionCard';
import styles from './DeploymentVersions.module.css';

export function DeploymentVersions({ projectId, serviceId, canSwitch, actions, onSelect }: { readonly projectId: string; readonly serviceId: string; readonly canSwitch: boolean; readonly actions: ReleaseActions; readonly onSelect: (id: string) => void }) {
  const t = useT(), date = useDateText(), id = useId(), reasonInput = useRef<HTMLTextAreaElement>(null);
  const slots = useApiQuery(queryKeys.slots(serviceId), () => api.services.listSlots(serviceId));
  const releases = useApiQuery(queryKeys.releases(serviceId), () => api.services.listReleases(serviceId));
  const inProgress = !releases.error ? releases.data?.items.find((release) => isInFlight(release.status)) : undefined;
  usePollingRefetch(slots.refetch, 5_000);
  let versions: DeployedVersions = {}, readError: string | undefined;
  try { if (slots.data) versions = deployedVersions(slots.data.items); } catch (cause) { readError = t(errorMessage(cause)); }
  const known = !!slots.data && !slots.error && !readError;
  const p = useTrafficConfirmation(projectId, serviceId, canSwitch, actions, slots.refetch), snapshot = p.snapshot;
  const stale = !!snapshot && (!known || !!releases.error || !!inProgress || !trafficSnapshotMatches(snapshot, versions));
  useEffect(() => { if (p.fieldError) reasonInput.current?.focus(); }, [p.fieldError]);
  const reasonField = <FormField label={t('release.traffic.reason')} hint={t('release.traffic.reasonHint')} hintId={`${id}-hint`} error={p.fieldError} errorId={`${id}-error`}>
    <textarea ref={reasonInput} name="trafficReason" rows={2} value={p.reason} disabled={p.busy} aria-invalid={!!p.fieldError} aria-describedby={`${id}-hint${p.fieldError ? ` ${id}-error` : ''}`} aria-errormessage={p.fieldError ? `${id}-error` : undefined} onChange={(event) => { p.setReason(event.target.value); p.setFieldError(undefined); }} />
  </FormField>;
  return <section className={styles.section} aria-label={t('release.versions.title')}>
    <div className={styles.tools}><span>{t('release.versions.checked', { time: date(slots.dataUpdatedAt ? new Date(slots.dataUpdatedAt).toISOString() : undefined) })}</span><Button disabled={slots.isFetching} onClick={() => void slots.refetch()}>{t('release.versions.refresh')}</Button></div>
    {slots.isPending ? <p>{t('release.versions.loading')}</p> : null}
    {slots.error || readError ? <ActionNote tone="error">{slots.error ? errorMessage(slots.error) : readError}</ActionNote> : null}
    <div className={styles.grid}>{(['prod', 'preview'] as const).map((role) => <DeployedVersionCard key={role} role={role} slot={versions[role]} known={known} onSelect={onSelect} />)}</div>
    <p className={styles.note}>{t('release.versions.sharedData')}</p>
    {inProgress ? <ActionNote tone="neutral">{t('release.traffic.inProgress', { tag: inProgress.tag })} <Button onClick={() => onSelect(inProgress.id)}>{t('release.traffic.openInProgress')}</Button></ActionNote> : null}
    {canSwitch ? <div className={styles.action}>
      <Button disabled={!!actions.busy || !known || releases.isPending || !!releases.error || !!inProgress || !slotCanOpen(versions.preview)} onClick={() => void p.check()}>{t(p.checking ? 'release.traffic.checking' : snapshot ? 'release.traffic.recheck' : 'release.traffic.check', { tag: versions.preview?.tag ?? '—' })}</Button>
      {snapshot ? <ConfirmationPanel question={t('release.traffic.question', { from: snapshot.prod?.tag ?? t('release.versions.empty'), to: snapshot.target.tag })} hint={t(snapshot.rollback ? 'release.traffic.rollbackHint' : 'release.traffic.goLiveHint')} confirmLabel={t(snapshot.rollback ? 'release.traffic.rollback' : 'release.traffic.goLive', { tag: snapshot.target.tag })} cancelLabel={t('release.traffic.cancel')} busy={p.busy} confirmDisabled={stale || !!actions.busy || !canSwitch} onConfirm={() => void p.confirm(stale)} onCancel={p.cancel}>
        <DefinitionList items={[{ label: t('release.versions.prod'), value: <code>{snapshot.prod?.commitSha ?? t('release.versions.empty')}</code> }, { label: t('release.traffic.target'), value: <code>{snapshot.target.commitSha}</code> }, { label: t('release.prepare.checkedAt'), value: date(snapshot.checkedAt) }]} />
        {stale ? <ActionNote tone="error">{t('release.traffic.stale')}</ActionNote> : null}
        {reasonField}
      </ConfirmationPanel> : p.reason ? reasonField : null}
    </div> : <p className={styles.note}>{t('release.traffic.noPermission')}</p>}
    {actions.busy ? <ActionNote tone="neutral">{t('release.actions.busy')}</ActionNote> : null}
    {p.error ? <ActionNote tone="error">{p.error} {t('release.traffic.recovery')}</ActionNote> : null}
    {p.done ? <ActionNote tone="success">{p.done}</ActionNote> : null}
  </section>;
}
