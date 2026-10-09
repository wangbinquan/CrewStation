import { useEffect, useRef, useState } from 'react';
import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { ReleaseJourneyDetailSchema, TrafficSwitchDtoSchema } from '@crewstation/contracts';
import type { ReleaseJourneyDetail } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { errorMessage, isApiClientError } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { LaunchIntentSchema, readWizardStorage, removeWizardStorage, saveWizardStorage, wizardStorageKey } from './storage';
import type { LaunchIntent } from './storage';

export function useJourneyActions(detail: ReleaseJourneyDetail, scope: { userId: string; projectId: string; space: string; canPublish: boolean; canSwitch: boolean }, refresh: () => Promise<unknown>, readingError: unknown) {
  const t = useT(), client = useQueryClient(), lock = useRef(false), key = wizardStorageKey(scope.userId, scope.space, scope.projectId, `launch:${detail.id}`);
  const [note, setNote] = useState(''), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const [storedIntent, setIntent] = useState<LaunchIntent | undefined>(() => readWizardStorage(key, LaunchIntentSchema));
  const intent = detail.trafficSwitch ? undefined : storedIntent;
  const [review, setReview] = useState<ReleaseJourneyDetail['continuation'] | undefined>(() => detail.continuation.canLaunch ? detail.continuation : undefined);
  if (!review && detail.continuation.canLaunch) setReview(detail.continuation);
  useEffect(() => { if (detail.trafficSwitch) removeWizardStorage(key); }, [detail.trafficSwitch, key]);
  const stale = !review || review.expectedActiveReleaseId !== detail.continuation.expectedActiveReleaseId || review.targetRevision !== detail.continuation.targetRevision;
  const verify = async () => {
    if (lock.current || readingError || !scope.canPublish || !detail.continuation.canVerify || !detail.continuation.targetRevision) return;
    if (!onlineManager.isOnline()) { setError(t('ui.connection.notSent')); return; }
    lock.current = true; setBusy(true); setError(undefined);
    try {
      const response = ReleaseJourneyDetailSchema.parse(await api.services.verifyReleaseJourney(detail.id, {
        requestKey: crypto.randomUUID(), expectedRevision: detail.revision, expectedReleaseId: detail.snapshot.releaseId, expectedCommitSha: detail.snapshot.commitSha,
        expectedTargetRevision: detail.continuation.targetRevision, ...(note.trim() ? { note: note.trim() } : {}),
      }));
      if (response.id !== detail.id) throw new Error(t('release.wizard.receiptMismatch'));
      setNote(''); await refresh();
    } catch (cause) { setError(errorMessage(cause)); await refresh(); }
    finally { lock.current = false; setBusy(false); }
  };
  const launch = async () => {
    if (lock.current || readingError || intent || !scope.canSwitch || !detail.continuation.canLaunch || stale || !review?.targetRevision) return;
    if (!onlineManager.isOnline()) { setError(t('ui.connection.notSent')); return; }
    const next: LaunchIntent = { requestKey: crypto.randomUUID(), journeyId: detail.id, toSlot: 'preview', expectedActiveRelease: review.expectedActiveReleaseId,
      expectedTargetRelease: detail.snapshot.releaseId, expectedTargetRevision: review.targetRevision, ...(reason.trim() ? { reason: reason.trim() } : {}) };
    if (!saveWizardStorage(key, next)) { setError(t('release.wizard.launchStorageRequired')); return; }
    setIntent(next); lock.current = true; setBusy(true); setError(undefined);
    try {
      const result = TrafficSwitchDtoSchema.parse(await api.services.switchTraffic(detail.snapshot.serviceId, next));
      if (result.journeyId !== detail.id || result.serviceId !== detail.snapshot.serviceId || result.releaseId !== detail.snapshot.releaseId) throw new Error(t('release.wizard.receiptMismatch'));
      setReason('');
      await Promise.all([['services', detail.snapshot.serviceId], ['projects', scope.projectId], ['release-journeys', detail.snapshot.serviceId]].map(queryKey => client.invalidateQueries({ queryKey })));
      await refresh();
    } catch (cause) {
      if (isApiClientError(cause) && (cause.details.requestSent === false || cause.status >= 400 && cause.status < 500)) { removeWizardStorage(key); setIntent(undefined); }
      setError(errorMessage(cause)); await refresh();
    } finally { lock.current = false; setBusy(false); }
  };
  return { note, setNote, reason, setReason, busy, error, intent, review, stale, verify, launch,
    recheck: () => { setReview(detail.continuation); setError(undefined); void refresh(); } };
}
