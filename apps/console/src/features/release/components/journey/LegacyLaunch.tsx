import { useEffect, useRef, useState } from 'react';
import { TrafficSwitchDtoSchema } from '@crewstation/contracts';
import type { ReleaseDto, SlotDto } from '@crewstation/contracts';
import { onlineManager } from '@tanstack/react-query';
import { api } from '../../../../shared/api/client';
import { errorMessage, isApiClientError } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { FormField } from '../../../../shared/ui/FormField';
import { Button } from '../../../../shared/ui/Button';
import { ExternalButtonLink } from '../../../../shared/ui/navigation/ButtonLink';
import { slotCanOpen } from '../../model/deployedVersions';
import { LaunchIntentSchema, readWizardStorage, removeWizardStorage, saveWizardStorage, wizardStorageKey } from '../../model/journey/storage';

const LegacyIntentSchema = LaunchIntentSchema.omit({ journeyId: true });
export function LegacyLaunch({ release, slots, userId, space, projectId, canSwitch, refresh, onAccepted }: {
  readonly release: ReleaseDto; readonly slots: readonly SlotDto[]; readonly userId: string; readonly space: string; readonly projectId: string;
  readonly canSwitch: boolean; readonly refresh: () => Promise<unknown>; readonly onAccepted: (id: string) => void;
}) {
  const t = useT(), mounted = useRef(true), lock = useRef(false), key = wizardStorageKey(userId, space, projectId, `legacy-launch:${release.id}`);
  const preview = slots.find(slot => slot.name === 'preview' && slot.releaseId === release.id), prod = slots.find(slot => slot.name === 'prod');
  const [intent, setIntent] = useState(() => readWizardStorage(key, LegacyIntentSchema));
  const [review, setReview] = useState({ active: prod?.releaseId ?? null, revision: preview?.targetRevision });
  const [reason, setReason] = useState(''), [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const stale = review.active !== (prod?.releaseId ?? null) || review.revision !== preview?.targetRevision;
  const confirm = async () => {
    if (lock.current || intent || !checked || !canSwitch || stale || !slotCanOpen(preview) || !preview?.targetRevision) return;
    if (!onlineManager.isOnline()) { setError(t('ui.connection.notSent')); return; }
    const next = { requestKey: crypto.randomUUID(), toSlot: 'preview' as const, expectedActiveRelease: review.active, expectedTargetRelease: release.id, expectedTargetRevision: preview.targetRevision, ...(reason.trim() ? { reason: reason.trim() } : {}) };
    if (!saveWizardStorage(key, next)) { setError(t('release.wizard.launchStorageRequired')); return; }
    setIntent(next); lock.current = true; setBusy(true); setError(undefined);
    try {
      const result = TrafficSwitchDtoSchema.parse(await api.services.switchTraffic(release.serviceId, next));
      if (!result.journeyId || result.releaseId !== release.id || result.serviceId !== release.serviceId) throw new Error(t('release.wizard.receiptMismatch'));
      if (mounted.current) { removeWizardStorage(key); setReason(''); onAccepted(result.journeyId); }
    } catch (cause) {
      if (isApiClientError(cause) && (cause.details.requestSent === false || cause.status >= 400 && cause.status < 500)) { removeWizardStorage(key); setIntent(undefined); }
      setError(errorMessage(cause)); await refresh();
    } finally { lock.current = false; setBusy(false); }
  };
  return <section aria-label={t('release.wizard.step.launch')}>
    <h2>{t('release.wizard.step.launch')}</h2>
    <p>{t('release.traffic.question', { from: prod?.tag ?? t('slot.empty'), to: release.tag })}</p>
    <p>{t('release.wizard.legacyLaunchHint')}</p>
    {slotCanOpen(preview) ? <ExternalButtonLink href={`//${preview!.host}`}>{t('release.wizard.openPreview')}</ExternalButtonLink> : null}
    {!intent ? <>
      <FormField label={t('release.traffic.reason')}><textarea maxLength={500} rows={2} value={reason} onChange={event => setReason(event.target.value)} disabled={busy || !canSwitch} /></FormField>
      <label><input type="checkbox" checked={checked} disabled={busy || !canSwitch} onChange={event => setChecked(event.target.checked)} />{t('release.wizard.legacyChecked')}</label>
      {stale ? <ActionNote tone="neutral">{t('release.wizard.targetChanged')} <Button onClick={() => { setReview({ active: prod?.releaseId ?? null, revision: preview?.targetRevision }); setChecked(false); }}>{t('release.wizard.recheck')}</Button></ActionNote> : null}
      <Button variant="primary" disabled={!canSwitch || busy || !checked || stale || !slotCanOpen(preview) || !preview?.targetRevision} onClick={() => void confirm()}>{t('release.wizard.launch', { tag: release.tag })}</Button>
    </> : <ActionNote tone="neutral">{t('release.wizard.launchUnknown')} <Button onClick={() => void refresh()}>{t('release.wizard.readLaunch')}</Button></ActionNote>}
    {!canSwitch ? <p>{t('release.wizard.ownerHandoff')}</p> : null}
    {error ? <ActionNote tone="error">{error}</ActionNote> : null}
  </section>;
}
