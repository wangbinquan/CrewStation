import type { DevSessionRebuildInspection, RebuildDevSessionRequest } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';

/** 一份确认对应一个请求编号；超时只重发原请求，不悄悄新建第二个容器。 */
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
  }, { onSuccess: (result) => { setInspection(result); setProfileName(result.profiles.some((p) => p.name === result.currentProfile) ? result.currentProfile : ''); } });
  const submit = useApiMutation((input: RebuildDevSessionRequest) => api.devSession.rebuild(projectId, input), { invalidate: [queryKeys.devSession(projectId)] });
  const profile = inspection?.profiles.find((p) => p.name === profileName);
  const inspect = () => { if (sending.current || check.isPending) return; setInspection(undefined); setSubmitted(undefined); submit.reset(); check.mutate(); };
  const confirm = async () => {
    if (sending.current || !inspection || !profile) return;
    const input = submitted ?? { requestId: crypto.randomUUID(), expectedTaskId: inspection.taskId, expectedUpdatedAt: inspection.updatedAt,
      expectedVolumeUid: inspection.volume.uid, expectedPodUid: inspection.podUid, profile: { name: profile.name, cpu: profile.cpu, memory: profile.memory, storage: profile.storage } };
    sending.current = true; setSubmitted(input);
    try { await submit.mutateAsync(input); } catch { /* 错误由回执区展示；保留原请求用于显式重试。 */ }
    finally { sending.current = false; }
  };
  return { inspection, profile, profileName, setProfileName, submitted, check, submit, inspect, confirm, cancel: () => setInspection(undefined) };
}
