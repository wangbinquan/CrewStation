import { eq, sql } from 'drizzle-orm';
import type { Database } from '@crewstation/persistence';
import type { BusinessRecoveryTarget } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { executionCommandFixture } from './executionCommandFixture';
import { drizzleTaskRecoveryRequests } from '../adapters/persistence/recovery/repository';
import { executionOperations } from '../adapters/persistence/executionTables';
import { executionTaskStates } from '../adapters/persistence/execution/lifecycleTables';
import { executionLogs } from '../adapters/persistence/execution/projectionTables';
import { contracts } from '../adapters/persistence/tables';
import type { RecoveryAdmission } from '../ports/taskRecovery';

export async function taskRecoveryFixture(db: Database, images?: Parameters<typeof executionCommandFixture>[2]) {
  const f = await executionCommandFixture(db, undefined, images), repository = drizzleTaskRecoveryRequests(db);
  // Fixture models a deployed application declaring recovery; public manifest parsing is covered separately.
  await db.update(contracts).set({ tasksSpec: sql`tasks_spec || '{"recovery":{"actions":["resume-task","rebuild-workspace","retry-subtask","resume-subtask","restart-task"]}}'::jsonb` }).where(eq(contracts.releaseId, f.releaseId));
  const operation = (await db.select().from(executionOperations).where(eq(executionOperations.serviceId, f.serviceId)))[0]!;
  await db.insert(executionTaskStates).values({ taskId: f.task.id, serviceId: f.serviceId, state: 'paused', generation: 2 });
  await db.insert(executionLogs).values({ taskId: f.task.id, serviceId: f.serviceId, taskState: 'paused', taskGeneration: 2 });
  const target: BusinessRecoveryTarget = { taskId: f.task.id, action: 'resume-task', expectedGeneration: 2, materialDigest: operation.effectiveDigest, volumeUid: 'original-pvc' };
  const admission: RecoveryAdmission = { serviceId: f.serviceId, projectId: f.projectId, requestedBy: newResourceId(), controlEpoch: f.fence.epoch,
    assessmentDigest: 'a'.repeat(64), request: { requestKey: 'recover-once', target, assessmentDigest: 'a'.repeat(64) } };
  const source = { releaseId: f.releaseId, physicalSlot: 'blue' as const, podUid: 'pod-one', ready: true, role: 'prod' as const };
  return { ...f, repository, admission, source, authorization: { source, fence: f.fence } };
}
