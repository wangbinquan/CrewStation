import type { RuntimeTaskFact, RuntimeAttemptFact, UsageExecutionIdentity, RuntimeSourceKind } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';

export const runtimeSourceKind = (task: Pick<RuntimeTaskFact, 'source'>): RuntimeSourceKind => task.source?.kind ?? 'business-task';
export function validateRuntimeFacts(tasks: RuntimeTaskFact[]) {
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) throw conflict('运行观测对象 ID 重复，无法安全汇总');
    seen.add(task.id);
    const source = task.source;
    if (source?.kind !== 'development-agent') {
      if (task.protocol === 'development') throw conflict('开发观测缺少原受理身份');
      continue;
    }
    const i = source.identity, a = task.attempts[0];
    if (task.protocol !== 'development' || task.id !== i.executionId || task.projectId !== i.projectId || i.executionGeneration !== 1 ||
      task.attempts.length !== 1 || !a || a.id !== i.agentId || a.agentId !== i.agentId || a.executionId !== i.executionId ||
      a.taskId !== i.taskId || a.attempt !== 1 || a.kind !== 'agent' || !a.profileId || a.profileRevision === null ||
      task.closedAt !== null || a.startedAt !== null || a.endedAt !== null) throw conflict('开发观测事实没有唯一的原执行身份');
  }
}
export function runtimeLedgerScope(task: RuntimeTaskFact) {
  return { projectId: task.projectId, taskId: task.source?.kind === 'development-agent' ? task.source.identity.taskId : task.id };
}
/** Coarse ownership retains wrong Agent evidence as unknown, while excluding unselected siblings. */
export function runtimeOwnsIdentity(task: RuntimeTaskFact, i: UsageExecutionIdentity) {
  const scope = runtimeLedgerScope(task);
  if (i.projectId !== scope.projectId || i.taskId !== scope.taskId) return false;
  if (task.source?.kind === 'development-agent') return 'sourceKind' in i && i.sourceKind === 'development-agent' && i.executionId === task.id && i.executionGeneration === 1;
  return !('sourceKind' in i);
}
export function runtimeMatchesAttempt(task: RuntimeTaskFact, a: RuntimeAttemptFact, i: UsageExecutionIdentity) {
  if (!runtimeOwnsIdentity(task, i) || i.executionId !== a.executionId || i.executionGeneration !== a.attempt) return false;
  return task.source?.kind === 'development-agent' ? 'agentId' in i && i.agentId === task.source.identity.agentId && i.agentId === a.agentId : 'subtaskId' in i && i.subtaskId === a.id;
}
