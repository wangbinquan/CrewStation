import { useEffect, useRef, useState } from 'react';
import { TrafficSwitchDtoSchema } from '@crewstation/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { loadTrafficSnapshot } from './deployedVersions';
import type { TrafficSnapshot } from './deployedVersions';
import type { ReleaseActions } from './useReleaseActions';

export function useTrafficConfirmation(projectId: string, serviceId: string, canSwitch: boolean, actions: ReleaseActions, refresh: () => Promise<unknown>) {
  const t = useT(), client = useQueryClient(), lock = useRef(false), mounted = useRef(true);
  const [snapshot, setSnapshot] = useState<TrafficSnapshot>(), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(false), [error, setError] = useState<string>(), [fieldError, setFieldError] = useState<string>(), [done, setDone] = useState<string>();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { markDraft } = actions;
  useEffect(() => { markDraft('traffic', reason !== '' || busy); return () => markDraft('traffic', false); }, [reason, busy, markDraft]);
  const describe = (cause: unknown) => { const message = errorMessage(cause); return message.startsWith('release.') ? t(message) : message; };
  // 确认弹窗里「重新核对」保留当前核对（`keep`），弹窗不因重新读取而关掉又弹出；读不到时核对留着、原因显示在弹窗里。
  const check = async (keep = false) => {
    if (lock.current || !canSwitch || !actions.begin('traffic')) return;
    lock.current = true; setChecking(true); setError(undefined); setDone(undefined); if (!keep) setSnapshot(undefined);
    try { const next = await loadTrafficSnapshot(serviceId); if (mounted.current) setSnapshot(next); await refresh(); }
    catch (cause) { if (mounted.current) setError(describe(cause)); }
    finally { lock.current = false; setChecking(false); actions.finish('traffic'); }
  };
  const confirm = async (stale: boolean) => {
    if (lock.current || !canSwitch || !snapshot || stale) return;
    if (reason.length > 500) { setFieldError(t('release.traffic.reasonInvalid')); return; }
    if (!actions.begin('traffic')) return; lock.current = true; setBusy(true); setError(undefined); setFieldError(undefined);
    try {
      const parsed = TrafficSwitchDtoSchema.safeParse(await api.services.switchTraffic(serviceId, { toSlot: 'preview', expectedActiveRelease: snapshot.prod?.id ?? null, expectedTargetRelease: snapshot.target.id, ...(reason.trim() ? { reason: reason.trim() } : {}) }));
      if (!parsed.success) throw new Error('release.traffic.responseUnknown'); const response = parsed.data;
      if (response.serviceId !== serviceId || response.releaseId !== snapshot.target.id || response.previousReleaseId !== snapshot.prod?.id || response.toSlot !== 'prod') throw new Error('release.traffic.responseUnknown');
      if (mounted.current) { setReason(''); markDraft('traffic', false); setDone(t('release.traffic.done', { tag: snapshot.target.tag })); }
    } catch (cause) { if (mounted.current) setError(describe(cause)); }
    finally {
      if (mounted.current) setSnapshot(undefined);
      await Promise.all([queryKeys.slots(serviceId), queryKeys.releases(serviceId), queryKeys.trafficSwitches(serviceId), queryKeys.devSession(projectId), ['projects', projectId, 'comparison-details']].map((queryKey) => client.invalidateQueries({ queryKey })));
      lock.current = false; setBusy(false); actions.finish('traffic');
    }
  };
  return { snapshot, reason, setReason, busy, checking, error, fieldError, setFieldError, done, check, confirm, cancel: () => { if (!lock.current) setSnapshot(undefined); } };
}
