import type { DevSessionRebuildInspection, RebuildDevSessionRequest } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';

/** 核对结果里的缺省套餐：当前套餐仍可用就是它，否则留空让人选。 */
const defaultProfile = (inspection: DevSessionRebuildInspection): string => (inspection.profiles.some((p) => p.id === inspection.currentProfile) ? inspection.currentProfile : '');

/**
 * 一份确认对应一个请求编号；超时只重发原请求，不悄悄新建第二个容器。
 * 选过的套餐是草稿（2026-09-23 起确认在弹窗里）：取消只关窗，下次核对时它仍可用就沿用，「清空」回到缺省套餐。
 */
export function useSessionRebuild(projectId: string, taskId: string) {
  const t = useT();
  const [inspection, setInspection] = useState<DevSessionRebuildInspection>();
  const [profileName, setProfileName] = useState('');
  const [submitted, setSubmitted] = useState<RebuildDevSessionRequest>();
  const sending = useRef(false);
  const check = useApiMutation(async (_: void) => {
    const result = await api.devSession.inspectRebuild(projectId);
    if (result.taskId !== taskId || result.projectId !== projectId) throw new Error(t('devSession.rebuild.invalidInspection'));
    return result;
  }, { onSuccess: (result) => { setInspection(result); setProfileName((current) => (current !== '' && result.profiles.some((p) => p.id === current) ? current : defaultProfile(result))); } });
  const submit = useApiMutation((input: RebuildDevSessionRequest) => api.devSession.rebuild(projectId, input), { invalidate: [queryKeys.devSession(projectId)] });
  const profile = inspection?.profiles.find((p) => p.id === profileName);
  const inspect = () => { if (sending.current || check.isPending) return; setInspection(undefined); setSubmitted(undefined); submit.reset(); check.mutate(); };
  const confirm = async () => {
    if (sending.current || !inspection || !profile) return;
    const input = submitted ?? { requestId: crypto.randomUUID(), expectedTaskId: inspection.taskId, expectedUpdatedAt: inspection.updatedAt,
      expectedVolumeUid: inspection.volume.uid, expectedPodUid: inspection.podUid, ...(inspection.reason ? { reason: inspection.reason } : {}), profile: { id: profile.id, name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage } };
    sending.current = true; setSubmitted(input);
    try { await submit.mutateAsync(input); } catch { /* 错误由回执区展示；保留原请求用于显式重试。 */ }
    finally { sending.current = false; }
  };
  const profileChanged = inspection !== undefined && profileName !== defaultProfile(inspection);
  return { inspection, profile, profileName, setProfileName, profileChanged, resetProfile: () => { if (inspection) setProfileName(defaultProfile(inspection)); },
    submitted, check, submit, inspect, confirm, cancel: () => setInspection(undefined) };
}
