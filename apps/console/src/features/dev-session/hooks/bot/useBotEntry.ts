import { useState } from 'react';
import type { AgentInstanceDto } from '@crewstation/contracts';

function read(scope: string, legacyScope: string): string {
  try { const value = sessionStorage.getItem(scope) ?? sessionStorage.getItem(legacyScope) ?? ''; return value.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value) ? value : ''; } catch { return ''; }
}
/** Honor a user's existing legacy selection. No heuristic merges, first-row selection or automatic model writes. */
export function useBotEntry(agents: readonly AgentInstanceDto[], userId: string, projectId: string, taskId: string) {
  const scope = `cs-bot-entry:${userId}:${projectId}:${taskId}`;
  const [choice, setChoice] = useState(() => ({ scope, picked: read(scope, `cs-bot-selection:${userId}:${projectId}:${taskId}`) }));
  const current = choice.scope === scope ? choice : { scope, picked: read(scope, `cs-bot-selection:${userId}:${projectId}:${taskId}`) };
  if (current !== choice) setChoice(current);
  const { picked } = current;
  const select = (agentId: string) => { setChoice({ scope, picked: agentId }); try { sessionStorage.setItem(scope, agentId); } catch { /* Page-local selection still works. */ } };
  return { picked, selected: agents.find(agent => agent.agentId === picked && !agent.botContext), select };
}
