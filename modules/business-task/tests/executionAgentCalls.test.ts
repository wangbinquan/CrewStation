// RFC-034 v2 §4：Agent 子任务在派发 startBusinessAgent 之前受理一条执行记录；受理失败不派发（不留无记录的执行），
// 下一轮调和重试；受理身份是任务、子任务尝试、发布里的 Agent 档案与算力档位修订。
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { BusinessSubtaskV3Dto } from '@crewstation/contracts';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import type { BusinessCall } from '../ports/runtime';
import { businessTaskMigrations } from '../wiring';
import { executionAgentFixture } from './executionAgentFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-034 v2 business Agent call acceptance', () => {
  let tdb: TestDatabase;
  beforeEach(async () => { tdb = await createTestDatabase([businessTaskMigrations]); });
  afterEach(async () => { await tdb?.drop(); });

  test('acceptance precedes the start command, and a failed acceptance leaves the subtask pending without dispatch', async () => {
    const f = await executionAgentFixture(tdb.db);
    const view = await (await f.request(f.path, f.input)).json() as BusinessSubtaskV3Dto;
    f.ready();
    await f.make({ agentCalls: { accept: async () => { throw new Error('recorder offline'); } } }).module.api.v3.runOnce();
    expect(f.agentBehavior.starts).toBe(0);
    expect((await f.get(view.id)).process).toBe('not-started');
    const accepted: Array<{ call: BusinessCall; startsAtAcceptance: number }> = [];
    await f.make({ agentCalls: { accept: async (call) => { accepted.push({ call, startsAtAcceptance: f.agentBehavior.starts }); } } }).module.api.v3.runOnce();
    expect(f.agentBehavior.starts).toBe(1);
    const runtimeTaskId = f.starts.find((entry) => entry.command.type === 'startBusinessAgent')!.taskId;
    expect(accepted).toEqual([{ startsAtAcceptance: 0, call: {
      projectId: f.projectId, taskId: f.task.id, taskLabel: f.task.labels['name'] ?? f.task.id, subtaskId: view.id, attempt: 1, runtimeTaskId, agentId: view.executionId,
      agentKey: f.profileId, agentLabel: expect.any(String), profile: { id: f.computeId, revision: 1, name: 'compute' }, protocol: 'opencode',
    } }]);
  });
});
