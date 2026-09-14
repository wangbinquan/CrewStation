import { useRef, useState } from 'react';
import { errorMessage } from '../../../shared/api/useApi';
import type { DevAgentsHandle } from './useDevAgents';

interface MessageDraft {
  readonly text: string;
  readonly revision: number;
  readonly sending: boolean;
  readonly error?: string;
}
const EMPTY: MessageDraft = { text: '', revision: 0, sending: false };

/** 每个历史 Agent 独立保留输入；回执只能清除它发出时的那一版草稿。 */
export function useHistoricalMessages(mutation: DevAgentsHandle['sendMessage']) {
  const current = useRef<Record<string, MessageDraft>>({});
  const [drafts, setDrafts] = useState<Record<string, MessageDraft>>({});
  const update = (agentId: string, change: (draft: MessageDraft) => MessageDraft) => {
    const next = { ...current.current, [agentId]: change(current.current[agentId] ?? EMPTY) };
    current.current = next; setDrafts(next);
  };
  const edit = (agentId: string, text: string) => update(agentId, (draft) => ({ ...draft, text, revision: draft.revision + 1, error: undefined }));
  const send = (agentId: string): boolean => {
    const sent = current.current[agentId] ?? EMPTY;
    if (sent.sending || sent.text.trim() === '') return false;
    // 同步锁定当前对象，连续键盘事件不能在 React 重渲染前重复派发。
    update(agentId, (draft) => ({ ...draft, sending: true, error: undefined }));
    void mutation.mutateAsync({ agentId, content: sent.text.trim() }).then(
      () => update(agentId, (draft) => ({ ...draft, sending: false, text: draft.revision === sent.revision ? '' : draft.text })),
      (error: unknown) => update(agentId, (draft) => ({ ...draft, sending: false, error: errorMessage(error) })),
    );
    return true;
  };
  return { drafts, edit, send, dirty: Object.values(drafts).some((draft) => draft.text !== ''), busy: Object.values(drafts).some((draft) => draft.sending) };
}
