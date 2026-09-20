import type { AgentPermission } from '@crewstation/contracts';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../../shared/api/useApi';
import type { DevAgentsHandle } from './useDevAgents';

interface StartDraft {
  readonly compute: string;
  readonly permission: AgentPermission;
  readonly prompt: string;
  readonly open: boolean;
  readonly busy: boolean;
  readonly error?: string;
}
const EMPTY: StartDraft = { compute: '', permission: 'edit', prompt: '', open: false, busy: false };

/** 草稿属于当前历史会话，收起表单不丢输入；已发出的启动不会因返回名册而取消。 */
export function useHistoricalStart(mutation: DevAgentsHandle['start'], onStarted: (agentId: string, showResult: boolean) => void) {
  const current = useRef(EMPTY), mounted = useRef(true);
  const [draft, setDraft] = useState(EMPTY);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const update = (next: StartDraft) => { current.current = next; setDraft(next); };
  const edit = (change: Partial<Pick<StartDraft, 'compute' | 'permission' | 'prompt'>>) => {
    if (!current.current.busy) update({ ...current.current, ...change, error: undefined });
  };
  const setOpen = (open: boolean) => update({ ...current.current, open });
  const start = () => {
    const sent = current.current;
    if (sent.busy || sent.prompt.trim() === '') return;
    // 必须在 React 更新 disabled 之前锁定，防止连续点击创建两个真正的 Agent。
    update({ ...sent, busy: true, error: undefined });
    void mutation.mutateAsync({ compute: sent.compute === '' ? { kind: 'default' } : { kind: 'profile', profileId: sent.compute }, permission: sent.permission, prompt: sent.prompt.trim() }).then(
      (agent) => {
        if (!mounted.current) return;
        const showResult = current.current.open;
        update(EMPTY); onStarted(agent.agentId, showResult);
      },
      (error: unknown) => { if (mounted.current) update({ ...current.current, busy: false, error: errorMessage(error) }); },
    );
  };
  return { ...draft, edit, setOpen, start, dirty: draft.compute !== '' || draft.permission !== 'edit' || draft.prompt !== '' };
}

export type HistoricalStartHandle = ReturnType<typeof useHistoricalStart>;
