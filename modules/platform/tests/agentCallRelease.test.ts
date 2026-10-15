// RFC-034 v2 §4.4：执行环境释放事件是通用兜底——其中仍在运行的执行记为中断；记录器缺失时原地重试而不是吞掉事件。
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, TaskId } from '@crewstation/contracts';
import { DomainTopic } from '@crewstation/contracts';
import { eventbusMigrations, publishDomainEvent } from '@crewstation/eventbus';
import { noopLogger } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { agentCallReleaseConsumer } from '../adapters/observability/agentCallRelease';
import type { AgentCallRecorderPort } from '../ports/agentCalls';

const available = await testDatabaseAvailable();
const project = '01a0bf5d-8f4b-7e40-82e1-9a99060b1192' as ProjectId, released = '01a0bf5d-8f4b-7e41-82e1-9a99060b1192' as TaskId;

describe.skipIf(!available)('RFC-034 v2 release backstop', () => {
  let tdb: TestDatabase;
  beforeAll(async () => { tdb = await createTestDatabase([eventbusMigrations]); });
  afterAll(async () => { await tdb.drop(); });

  test('a released environment interrupts its running calls once the recorder is available', async () => {
    const closed: Array<[string, string]> = [];
    const recorder: { current?: AgentCallRecorderPort } = {};
    const consumer = agentCallReleaseConsumer(tdb.db, noopLogger, () => recorder.current);
    await publishDomainEvent(tdb.db, DomainTopic.taskReleased, { occurredAt: '2026-10-14T00:10:00.000Z', projectId: project, taskId: released, kind: 'business', reason: 'business' });
    await publishDomainEvent(tdb.db, DomainTopic.projectArchived, { occurredAt: '2026-10-14T00:11:00.000Z', projectId: project });
    expect(await consumer.runOnce()).toBe(0);
    recorder.current = { accept: async () => '', usage: async () => undefined, finish: async () => undefined,
      closeRuntimeTask: async (runtimeTaskId, at) => { closed.push([runtimeTaskId, at.toISOString()]); return 1; } };
    expect(await consumer.runOnce()).toBe(2);
    expect(closed).toEqual([[released, '2026-10-14T00:10:00.000Z']]);
    expect(await consumer.runOnce()).toBe(0);
  });
});
