import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { newResourceId } from '@crewstation/kernel';
import type { Actor } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { businessTaskMigrations } from '../wiring';
import { agentImageResumeFixture } from './agentImageResumeFixture';
import { executionSubtasks } from '../adapters/persistence/execution/subtaskTables';
import { subtaskProjections } from '../adapters/persistence/execution/projectionTables';
import { sessionHomes } from '../adapters/persistence/sessions/tables';
import { contracts } from '../adapters/persistence/tables';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC029 Agent 恢复原镜像、停止和原生会话证明', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterAll(async () => { await tdb?.drop(); });
  test('只读评估区分fresh与原生resume；不解密最新凭据、不新建引用或执行', async () => {
    const f = await agentImageResumeFixture(tdb.db), actor: Actor = { userId: newResourceId() as Actor['userId'], isAdmin: true };
    await tdb.db.update(contracts).set({ tasksSpec: sql`tasks_spec || '{"recovery":{"actions":["retry-subtask","resume-subtask"]}}'::jsonb` }).where(eq(contracts.releaseId, f.releaseId));
    // This read fixture retains a real admitted encrypted plan/session but models a failed terminal attempt.
    await tdb.db.update(executionSubtasks).set({ view: sql`view || '{"state":"failed"}'::jsonb` }).where(eq(executionSubtasks.id, f.view.id));
    await tdb.db.update(subtaskProjections).set({ sourceStopped: true }).where(eq(subtaskProjections.subtaskId, f.view.id));
    const proof = { state: 'running', persistent: true, stopped: false, activeChildren: false, volumeUid: 'runtime-image-workspace', volumeVerified: true, image: f.task.runtimeImage!.image, runtimeImage: f.task.runtimeImage };
    f.environmentPort.inspectBusinessRecovery = async () => proof;
    f.port.inspectReference = async () => true;
    const assess = () => f.module.api.assessTaskRecovery(actor, f.task.id, f.view.id);
    const before = await tdb.db.select().from(sessionHomes).where(eq(sessionHomes.taskId, f.task.id)), inputs = [...f.inputs];
    const first = await assess(); expect(first.reasons).toEqual([]); expect(first.actions.map((a) => a.target.action)).toEqual(['retry-subtask', 'resume-subtask']);
    expect(first.actions[1]?.target).toMatchObject({ resumeSessionId: 'image-session', expectedAttempt: 1 });
    expect(await tdb.db.select().from(sessionHomes).where(eq(sessionHomes.taskId, f.task.id))).toEqual(before);
    expect(f.inputs).toEqual(inputs); expect(JSON.stringify(first)).not.toContain('sealedPayload'); expect(JSON.stringify(first)).not.toContain('hello');
    await tdb.db.update(sessionHomes).set({ state: 'occupied', leaseExecutionId: newResourceId() }).where(eq(sessionHomes.taskId, f.task.id));
    expect(await assess()).toMatchObject({ actions: [{ target: { action: 'retry-subtask' } }], reasons: ['original_session_incompatible'] });
    // Occupied native home prevents resume, while explicit fresh keeps its own new home.
    await tdb.db.update(subtaskProjections).set({ sourceStopped: false }).where(eq(subtaskProjections.subtaskId, f.view.id));
    expect(await assess()).toMatchObject({ actions: [], reasons: ['original_execution_not_stopped'] });
    await tdb.db.update(subtaskProjections).set({ sourceStopped: true }).where(eq(subtaskProjections.subtaskId, f.view.id));
    f.port.inspectReference = async () => false;
    expect(await assess()).toMatchObject({ actions: [], reasons: ['original_image_incompatible'] });
    f.port.inspectReference = async () => true; proof.volumeUid = 'replacement';
    expect(await assess()).toMatchObject({ actions: [], reasons: ['original_image_incompatible'] });
    proof.volumeUid = 'runtime-image-workspace';
    await tdb.db.update(executionSubtasks).set({ sealedPayload: 'unreadable-original' }).where(eq(executionSubtasks.id, f.view.id));
    expect(await assess()).toMatchObject({ actions: [], reasons: ['original_image_incompatible'] });
  });
});
