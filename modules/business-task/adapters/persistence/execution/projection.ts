import { taskObservationRepository } from './taskObservations';
import { projectSessionAlias } from '../sessions/repository';
import { expireExecutionLog } from './logRetention';
import { nextLogSequence } from './logEvents';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import type { TaskId } from '@crewstation/contracts';
import { BusinessExecutionEventSchema } from '@crewstation/contracts';
import { conflict, jsonHash, notFound, validation } from '@crewstation/kernel';
import type { ExecutionProjection } from '../../../ports/executionProjection';
import type { ExecutionSubtask } from '../../../domain/executionSubtask';
import { appendCommandSummary, projectCommandEvent } from '../../../domain/commandProjection';
import { executionCursor } from '../../../domain/executionCursor';
import { executionTransaction } from '../executionTransaction';
import { executionSubtasks as tasks } from './subtaskTables';
import { businessEvents as events, subtaskProjections as projections } from './projectionTables';
import { readProjectedEvents } from './projectionQueries';

/** Projection and source watermark commit together; neither HTTP observers nor Runner ACKs drive product state. */
export function drizzleExecutionProjection(db: Database): ExecutionProjection {
  return {
    ...taskObservationRepository(db),
    pendingConsumption: () => db.transaction(async (tx) => {
      const pending = alias(projections, 'consumption_pending');
      const rows = await tx.select({ task: tasks, projection: pending }).from(pending).innerJoin(tasks, eq(tasks.id, pending.subtaskId))
        .where(and(eq(pending.complete, true), eq(pending.sourceConsumed, false))).orderBy(asc(pending.polledAt), asc(tasks.id)).limit(20).for('update', { skipLocked: true, of: pending });
      for (const row of rows) await tx.update(projections).set({ polledAt: sql`clock_timestamp()` }).where(eq(projections.subtaskId, row.task.id));
      return rows.map(({ task, projection }) => ({ subtaskId: task.id, taskId: (task.runtimeTaskId ?? task.taskId) as TaskId, executionId: task.view.executionId, through: projection.sourceSequence, stopped: projection.sourceStopped }));
    }),
    consumed: async (subtaskId) => { await db.update(projections).set({ sourceConsumed: true }).where(and(eq(projections.subtaskId, subtaskId), eq(projections.complete, true))); },
    expire: () => expireExecutionLog(db),
    pending: async (limit) => {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw validation('投影批次无效');
      return db.transaction(async (tx) => {
        // A dispatch receipt can arrive after the source events; lazy initialization is repeatable.
        await tx.execute(sql`INSERT INTO business_task.subtask_projections(subtask_id)
          SELECT id FROM business_task.execution_subtasks t WHERE dispatch IN ('accepted','unknown')
          AND NOT EXISTS (SELECT 1 FROM business_task.subtask_projections p WHERE p.subtask_id=t.id) ORDER BY updated_at LIMIT 100
          ON CONFLICT DO NOTHING`);
        const pending = alias(projections, 'pending');
        const rows = await tx.select({ task: tasks, projection: pending }).from(pending).innerJoin(tasks, eq(tasks.id, pending.subtaskId))
          .where(and(eq(pending.complete, false), inArray(tasks.dispatch, ['accepted', 'unknown'])))
          .orderBy(asc(pending.polledAt), asc(tasks.id)).limit(limit).for('update', { skipLocked: true, of: pending });
        for (const row of rows) await tx.update(projections).set({ polledAt: sql`clock_timestamp()` }).where(eq(projections.subtaskId, row.task.id));
        return rows.map(({ task, projection }) => ({ subtask: { ...task, taskId: task.taskId as TaskId, requestKind: task.requestKind as ExecutionSubtask['requestKind'], dispatch: task.dispatch as ExecutionSubtask['dispatch'], leaseUntil: task.leaseUntil?.toISOString() ?? null }, sourceSequence: projection.sourceSequence }));
      });
    },
    append: (subtask, snapshot, batch) => executionTransaction(db, subtask.serviceId, async (tx) => {
      const current = (await tx.select().from(tasks).where(eq(tasks.id, subtask.view.id)).for('update'))[0];
      const projection = (await tx.select().from(projections).where(eq(projections.subtaskId, subtask.view.id)).for('update'))[0];
      if (!current || !projection) throw notFound('执行投影', subtask.view.id);
      if (projection.complete && projection.sourceStopped) return;
      const receipt = snapshot.receipt;
      if (snapshot.taskId !== (subtask.runtimeTaskId ?? subtask.taskId) || receipt.executionId !== current.view.executionId || receipt.attempt !== current.view.attempt || receipt.payloadDigest !== current.payloadDigest || receipt.incarnation !== current.incarnation) throw conflict('投影来源与已受理执行不一致');
      if (batch.length > 1000 || Buffer.byteLength(JSON.stringify(batch)) > 1024 * 1024) throw validation('事件投影批次过大');
      let through = projection.sourceSequence, view = current.view, summary = { stdout: projection.stdout, stderr: projection.stderr, truncated: projection.truncated };
      for (const raw of batch) {
        const input = BusinessExecutionEventSchema.parse(raw);
        if (input.frame.type === 'agent' && current.view.kind !== 'agent') throw validation('命令子任务不能接收 Agent 事件');
        if (Buffer.byteLength(JSON.stringify(input.frame)) > 256 * 1024) throw validation('单条事件超过容量');
        const digest = jsonHash(input);
        if (input.sequence <= through) {
          const prior = (await tx.select().from(events).where(and(eq(events.subtaskId, view.id), eq(events.sourceSequence, input.sequence))))[0];
          if (!prior || prior.digest !== digest) throw conflict('重复投影事件内容已变化');
          continue;
        }
        if (projection.complete || input.sequence !== through + 1 || input.sequence > snapshot.persistedThrough) throw conflict('投影事件必须连续且已经持久化');
        if (input.frame.type === 'result' && (!snapshot.complete || receipt.phase !== 'finished' || input.sequence !== receipt.lastSequence || jsonHash(input.frame.result) !== jsonHash(receipt.result))) throw conflict('结果水位尚未完整或与回执不符');
        if (input.frame.type === 'agent' && input.frame.event.type === 'session' && input.frame.event.sessionId) await projectSessionAlias(tx, { ...current, taskId: subtask.taskId }, input.frame.event.sessionId);
        summary = appendCommandSummary(summary, input);
        const { sequence, generation } = await nextLogSequence(tx, subtask.serviceId, subtask.taskId);
        const projected = projectCommandEvent(view, input, executionCursor(subtask.taskId, sequence, undefined, generation), summary); view = projected.view;
        await tx.insert(events).values({ serviceId: subtask.serviceId, taskId: subtask.taskId, sequence, subtaskId: view.id, sourceSequence: input.sequence, digest, event: projected.event });
        through = input.sequence;
      }
      if (projection.complete) return;
      const complete = projection.complete || (snapshot.complete && through === receipt.lastSequence && !!view.result);
      if (!complete && receipt.phase === 'unknown') view = { ...view, state: 'running', process: 'unknown', error: { code: 'execution_unknown', message: '等待可证明的执行结果' } };
      if (!complete && view.cancelRequestedAt) view = { ...view, state: 'cancelling' };
      // A concurrent dispatch owner must retain its lease until it reconciles; final projection is immutable in settle.
      await tx.update(tasks).set({ view, receipt, ...(complete && current.dispatch !== 'dispatching' ? { dispatch: 'accepted' } : {}) }).where(eq(tasks.id, view.id));
      await tx.update(projections).set({ sourceSequence: through, ...summary, complete }).where(eq(projections.subtaskId, view.id));
    }),
    events: (serviceId, taskId, query) => readProjectedEvents(db, serviceId, taskId, query),
    output: async (serviceId, taskId, subtaskId) => {
      const row = (await db.select({ view: tasks.view, projection: projections }).from(tasks).leftJoin(projections, eq(projections.subtaskId, tasks.id))
        .where(and(eq(tasks.id, subtaskId), eq(tasks.taskId, taskId), eq(tasks.serviceId, serviceId))))[0];
      if (!row) throw notFound('业务子任务', subtaskId);
      return { stdout: row.projection?.stdout ?? '', stderr: row.projection?.stderr ?? '', truncated: row.projection?.truncated ?? false, resultRef: row.view.result?.finalCursor ?? null };
    },
  };
}
