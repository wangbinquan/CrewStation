import { and, eq } from 'drizzle-orm';
import type { Database, Executor } from '@crewstation/persistence';
import { conflict } from '@crewstation/kernel';
import type { ExecutionSessions } from '../../../ports/executionSessions';
import type { ExecutionSession } from '../../../domain/executionSession';
import type { SubtaskCandidate } from '../../../ports/executionSubtasks';
import { sessionAliases as aliases, sessionHomes as homes } from './tables';
import type { ExecutionSubtask } from '../../../domain/executionSubtask';

export function drizzleExecutionSessions(db: Database): ExecutionSessions {
  return { get: async (serviceId, taskId, sessionId) => {
    const row = (await db.select({ alias: aliases, home: homes }).from(aliases).innerJoin(homes, eq(homes.sessionKey, aliases.sessionKey))
      .where(and(eq(aliases.serviceId, serviceId), eq(aliases.taskId, taskId), eq(aliases.sessionId, sessionId))))[0];
    return row ? { ...row.home, ...row.alias, state: row.home.state as ExecutionSession['state'] } : undefined;
  } };
}
/** The physical native home, not a native session alias, is the exclusive writer unit. */
export async function reserveSessionHome(tx: Executor, candidate: SubtaskCandidate): Promise<void> {
  if (!candidate.sessionKey) return;
  if (!candidate.runtimeTaskId || !candidate.sessionVolumeUid) throw conflict('原生会话身份缺少卷快照');
  if (candidate.sessionKey === candidate.runtimeTaskId) {
    await tx.insert(homes).values({ sessionKey: candidate.sessionKey, serviceId: candidate.serviceId, taskId: candidate.taskId, volumeUid: candidate.sessionVolumeUid, state: 'occupied', leaseExecutionId: candidate.view.executionId });
    return;
  }
  const home = (await tx.select().from(homes).where(eq(homes.sessionKey, candidate.sessionKey)).for('update'))[0];
  if (!home || home.serviceId !== candidate.serviceId || home.taskId !== candidate.taskId || home.volumeUid !== candidate.sessionVolumeUid) throw conflict('原会话任务或卷身份已变化', { code: 'session_incompatible' });
  if (home.state !== 'idle' || home.leaseExecutionId) throw conflict('原会话执行资源尚未停止', { code: 'session_in_use' });
  await tx.update(homes).set({ state: 'occupied', leaseExecutionId: candidate.view.executionId }).where(eq(homes.sessionKey, candidate.sessionKey));
}
export async function projectSessionAlias(tx: Executor, subtask: Pick<ExecutionSubtask, 'sessionKey' | 'serviceId' | 'taskId' | 'view'>, sessionId: string): Promise<void> {
  if (!subtask.sessionKey) throw conflict('Agent 会话事件缺少持久目录身份');
  const home = (await tx.select().from(homes).where(eq(homes.sessionKey, subtask.sessionKey)).for('update'))[0];
  if (!home || home.leaseExecutionId !== subtask.view.executionId || home.state !== 'occupied') throw conflict('Agent 已失去原生会话写入权');
  const prior = (await tx.select().from(aliases).where(and(eq(aliases.taskId, subtask.taskId), eq(aliases.sessionId, sessionId))))[0];
  if (prior && prior.sessionKey !== subtask.sessionKey) throw conflict('原生会话 ID 已属于另一执行目录');
  await tx.insert(aliases).values({ serviceId: subtask.serviceId, taskId: subtask.taskId, sessionId, sessionKey: subtask.sessionKey, sourceExecutionId: subtask.view.executionId })
    .onConflictDoUpdate({ target: [aliases.taskId, aliases.sessionId], set: { sourceExecutionId: subtask.view.executionId } });
}
/** Invoked only after task-runtime proves that the original Agent Pod has gone. */
export async function releaseSessionHome(tx: Executor, subtask: ExecutionSubtask): Promise<void> {
  if (!subtask.sessionKey) return;
  await tx.update(homes).set({ state: 'idle', leaseExecutionId: null }).where(and(eq(homes.sessionKey, subtask.sessionKey), eq(homes.leaseExecutionId, subtask.view.executionId)));
}
