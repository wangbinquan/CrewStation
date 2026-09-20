import { conflict } from '@crewstation/kernel';
import type { AgentProfile, BusinessTaskState, OutputContract, ProjectId, ReleaseId, ProfileRevisionRef, ServiceId, SubtaskId, SubtaskMode, SubtaskState, TaskId, TraceId, VolumeMode } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { BusinessTask } from '../../domain/businessTask';

import type { SubtaskRun } from '../../domain/subtaskRun';
import type { ContractRepository, SubtaskRepository, TaskRepository } from '../../ports/repositories';
import { contracts, subtasks, tasks } from './tables';

const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;

export function drizzleTaskRepository(db: Executor): TaskRepository {
  const toTask = (r: typeof tasks.$inferSelect): BusinessTask => ({
    id: r.id as TaskId, serviceId: r.serviceId as ServiceId, projectId: r.projectId as ProjectId, callerIdentity: r.callerIdentity, state: r.state as BusinessTaskState, traceId: r.traceId as TraceId,
    volumeMode: r.volumeMode as VolumeMode, profile: r.profile, labels: json<Record<string, string>>(r.labels), ...(r.message ? { message: r.message } : {}), createdAt: r.createdAt, updatedAt: r.updatedAt, ...(r.closedAt ? { closedAt: r.closedAt } : {}),
  });
  const toRow = (t: BusinessTask): typeof tasks.$inferInsert => ({ ...t, labels: t.labels, message: t.message ?? null, closedAt: t.closedAt ?? null });
  return {
    insert: async (t) => { await db.insert(tasks).values(toRow(t)); },
    update: async (t) => { await db.update(tasks).set(toRow(t)).where(eq(tasks.id, t.id)); },
    getById: async (id) => { const row = (await db.select().from(tasks).where(eq(tasks.id, id)))[0]; return row ? toTask(row) : undefined; },
    listByProject: async (projectId, limit) => (await db.select().from(tasks).where(eq(tasks.projectId, projectId)).orderBy(desc(tasks.createdAt)).limit(limit)).map(toTask),
  };
}

interface SubtaskSpec { prompt?: string; cwd?: string; command?: string[]; timeoutSeconds?: number; agentProfile?: AgentProfile; outputContract?: OutputContract; computeProfile?: ProfileRevisionRef; execution?: SubtaskRun['execution'] }

export function drizzleSubtaskRepository(db: Executor): SubtaskRepository {
  const toRun = (r: typeof subtasks.$inferSelect): SubtaskRun => {
    const spec = json<SubtaskSpec>(r.spec);
    return {
      id: r.id as SubtaskId, taskId: r.taskId as TaskId, name: r.name, kind: r.kind as 'agent' | 'command', ...(r.mode ? { mode: r.mode as SubtaskMode } : {}), state: r.state as SubtaskState, attempt: r.attempt,
      ...spec, ...(r.retryOperationId && r.retryOf ? { retry: { operationId: r.retryOperationId, previousId: r.retryOf as SubtaskId } } : {}), ...(r.runnerRef ? { runnerRef: r.runnerRef } : {}), ...(r.sessionId ? { sessionId: r.sessionId } : {}), ...(r.exitCode !== null ? { exitCode: r.exitCode } : {}), ...(r.output !== null ? { output: r.output } : {}),
      ...(r.businessOutcome ? { businessOutcome: r.businessOutcome } : {}), ...(r.contractResult ? { contractResult: json<SubtaskRun['contractResult']>(r.contractResult) } : {}), ...(r.error ? { error: r.error } : {}),
      createdAt: r.createdAt, ...(r.startedAt ? { startedAt: r.startedAt } : {}), ...(r.endedAt ? { endedAt: r.endedAt } : {}),
    };
  };
  const toRow = (s: SubtaskRun): typeof subtasks.$inferInsert => ({
    id: s.id, taskId: s.taskId, name: s.name, kind: s.kind, mode: s.mode ?? null, state: s.state, attempt: s.attempt,
    retryOperationId: s.retry?.operationId ?? null, retryOf: s.retry?.previousId ?? null,
    spec: ({ prompt: s.prompt, cwd: s.cwd, command: s.command, timeoutSeconds: s.timeoutSeconds, agentProfile: s.agentProfile, outputContract: s.outputContract, computeProfile: s.computeProfile, execution: s.execution }) as unknown,
    runnerRef: s.runnerRef ?? null, sessionId: s.sessionId ?? null, exitCode: s.exitCode ?? null, output: s.output ?? null, businessOutcome: s.businessOutcome ?? null,
    contractResult: s.contractResult ?? null, error: s.error ?? null, createdAt: s.createdAt, startedAt: s.startedAt ?? null, endedAt: s.endedAt ?? null,
  });
  return {
    findRetry: async (taskId, operationId) => {
      const row = (await db.select().from(subtasks).where(and(eq(subtasks.taskId, taskId), eq(subtasks.retryOperationId, operationId))))[0];
      return row ? toRun(row) : undefined;
    },
    reserveRetry: async (run) => {
      if (!run.retry) throw new Error('Retry reservation requires an operation identity');
      const created = await db.insert(subtasks).values(toRow(run)).onConflictDoNothing().returning();
      if (created[0]) return { run: toRun(created[0]), created: true };
      const old = (await db.select().from(subtasks).where(and(eq(subtasks.taskId, run.taskId), eq(subtasks.retryOperationId, run.retry.operationId))))[0];
      const existing = old ? toRun(old) : undefined;
      if (!existing || existing.retry?.previousId !== run.retry.previousId) throw conflict('重试操作已用于不同的子任务');
      return { run: existing, created: false };
    },
    insert: async (s) => { await db.insert(subtasks).values(toRow(s)); },
    update: async (s) => { await db.update(subtasks).set(toRow(s)).where(eq(subtasks.id, s.id)); },
    getById: async (id) => { const row = (await db.select().from(subtasks).where(eq(subtasks.id, id)))[0]; return row ? toRun(row) : undefined; },
    listByTask: async (taskId) => (await db.select().from(subtasks).where(eq(subtasks.taskId, taskId)).orderBy(subtasks.createdAt)).map(toRun),
    listActive: async (limit) => (await db.select().from(subtasks).where(inArray(subtasks.state, ['running', 'awaiting-input'])).orderBy(subtasks.createdAt).limit(limit)).map(toRun),
    findByExecution: async (executionTaskId) => { const row = (await db.select().from(subtasks).where(sql`${subtasks.spec}->'execution'->>'taskId' = ${executionTaskId}`))[0]; return row ? toRun(row) : undefined; },
    listPendingExecutions: async (limit) => (await db.select().from(subtasks).where(and(eq(subtasks.state, 'pending'), sql`${subtasks.spec}->'execution' IS NOT NULL`)).orderBy(subtasks.createdAt).limit(limit)).map(toRun),
    listUnreleasedExecutions: async (limit) => (await db.select().from(subtasks).where(and(inArray(subtasks.state, ['succeeded', 'failed', 'cancelled']), sql`${subtasks.spec}->'execution' IS NOT NULL`, sql`coalesce(${subtasks.spec}->'execution'->>'released', 'false') <> 'true'`)).orderBy(subtasks.createdAt).limit(limit)).map(toRun),
  };
}

export function drizzleContractRepository(db: Executor): ContractRepository {
  return {
    save: async (c) => {
      const values = { releaseId: c.releaseId, serviceId: c.serviceId, tag: c.tag, agentProfiles: c.agentProfiles as unknown, outputContracts: c.outputContracts as unknown, registeredAt: c.registeredAt };
      await db.insert(contracts).values(values).onConflictDoUpdate({ target: contracts.releaseId, set: values });
    },
    latest: async (serviceId) => {
      const row = (await db.select().from(contracts).where(eq(contracts.serviceId, serviceId)).orderBy(desc(contracts.registeredAt)).limit(1))[0];
      return row ? { serviceId: row.serviceId as ServiceId, releaseId: row.releaseId as ReleaseId, tag: row.tag, agentProfiles: json<AgentProfile[]>(row.agentProfiles), outputContracts: json<OutputContract[]>(row.outputContracts), registeredAt: row.registeredAt } : undefined;
    },
  };
}
