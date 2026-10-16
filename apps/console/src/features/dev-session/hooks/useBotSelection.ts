import type { AgentInstanceDto } from '@crewstation/contracts';
import { useCallback, useEffect, useState } from 'react';
import type { AgentSelection } from './useDevAgents';

function readSelection(key: string): string | undefined {
  try {
    const value = sessionStorage.getItem(key);
    return value !== null && value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value) ? value : undefined;
  } catch { return undefined; }
}

/** 只记当前浏览器页签里选中的身份（空串为新对话）；正文与执行状态仍从服务端回放。 */
export function useBotSelection(agents: readonly AgentInstanceDto[], userId: string, projectId: string, taskId: string): AgentSelection {
  const scope = `cs-bot-selection:${userId}:${projectId}:${taskId}`;
  const [choice, setChoice] = useState(() => ({ scope, agentId: readSelection(scope) }));
  const current = choice.scope === scope ? choice : { scope, agentId: readSelection(scope) };
  // 名册异步到达时只选一次；后续排序或轮询不能让同一个页面悄悄换成另一条对话。
  const picked = current.agentId ?? agents[0]?.agentId;
  if (choice !== current || picked !== current.agentId) setChoice({ scope, agentId: picked });
  useEffect(() => {
    if (picked === undefined) return;
    try { sessionStorage.setItem(scope, picked); } catch { /* 禁用浏览器存储时仍可在本页选择和聊天。 */ }
  }, [scope, picked]);
  const select = useCallback((agentId: string) => setChoice({ scope, agentId }), [scope]);
  return { picked, selected: agents.find(agent => agent.agentId === picked), select };
}
