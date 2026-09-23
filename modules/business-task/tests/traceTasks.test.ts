import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId, SubtaskId, TaskId, TraceId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { newResourceId } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleSubtaskRepository, drizzleTaskRepository } from '../adapters/persistence/drizzleRepositories';
import type { BusinessTask } from '../domain/businessTask';
import type { SubtaskRun } from '../domain/subtaskRun';
import type { BusinessTaskModule, BusinessTaskModuleDeps } from '../wiring';
import { businessTaskMigrations, createBusinessTaskModule } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase, bt: BusinessTaskModule;
const project = newResourceId() as ProjectId, other = newResourceId() as ProjectId, service = newResourceId() as ServiceId;
const trace = (n: number) => n.toString(16).padStart(32, '0') as TraceId;
const at = (minute: number) => new Date(Date.UTC(2026, 8, 23, 10, minute));
/** 这组用例只读库，不创建任务也不派发子任务；运行时端口一旦被调用就说明读取路径越界了。 */
const unused = new Proxy({}, { get: (_target, name) => () => { throw new Error(`调用链读取不该调用 ${String(name)}`); } });

function task(traceId: TraceId, created: Date, projectId = project): BusinessTask {
  return { id: newResourceId() as TaskId, serviceId: service, projectId, callerIdentity: 'demo/demo', state: 'closed', traceId, volumeMode: 'follow-container', profile: 'p', labels: {}, createdAt: created, updatedAt: at(40), closedAt: at(40) };
}
function run(taskId: TaskId, name: string, created: Date, extra: Partial<SubtaskRun> = {}): SubtaskRun {
  return { id: newResourceId() as SubtaskId, taskId, name, kind: 'agent', mode: 'oneshot', state: 'succeeded', attempt: 1, createdAt: created, ...extra };
}

let first: BusinessTask, failed: SubtaskRun, retried: SubtaskRun;
beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, businessTaskMigrations]);
  bt = createBusinessTaskModule({
    db: tdb.db, environments: unused, runner: unused, directory: unused, authorizer: unused, compute: unused, isAdmin: async () => false,
    settings: { mcp: [], outputLimitBytes: 1024, consumerName: 'business-task' },
  } as unknown as BusinessTaskModuleDeps);
  const tasks = drizzleTaskRepository(tdb.db), subtasks = drizzleSubtaskRepository(tdb.db);
  first = task(trace(1), at(0));
  const second = task(trace(2), at(10)), foreign = task(trace(1), at(1), other);
  for (const t of [first, second, foreign]) await tasks.insert(t);
  const execution = newResourceId() as TaskId;
  failed = run(first.id, 'analysis', at(1), { state: 'failed', error: '输出不符合契约', execution: { taskId: execution, runnerId: 'runner-1' } });
  retried = run(first.id, 'analysis', at(2), { attempt: 2, retry: { operationId: 'retry-1', previousId: failed.id } });
  for (const s of [failed, retried, run(second.id, 'summary', at(11)), run(foreign.id, 'leak', at(2))]) await subtasks.insert(s);
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('调用链查询（business-task）', () => {
  test('按 traceId 取本项目的业务任务，子任务含每次尝试、上一次尝试与执行环境', async () => {
    const rows = await bt.api.listTraceTasks(project, [trace(1)]);
    expect(rows.map((r) => r.id)).toEqual([first.id]);
    expect(rows[0]).toMatchObject({ traceId: trace(1), state: 'closed', callerIdentity: 'demo/demo', createdAt: at(0).toISOString(), closedAt: at(40).toISOString() });
    expect(rows[0]!.subtasks.map((s) => [s.name, s.attempt, s.state, s.retryOf ?? null, s.executionTaskId ?? null])).toEqual([
      ['analysis', 1, 'failed', null, failed.execution!.taskId],
      ['analysis', 2, 'succeeded', failed.id, null],
    ]);
    expect(rows[0]!.subtasks[0]).toMatchObject({ error: '输出不符合契约', createdAt: at(1).toISOString() });
  });

  test('同一个 traceId 在别的项目里的任务与子任务不会带出来；空列表不查', async () => {
    const both = await bt.api.listTraceTasks(project, [trace(1), trace(2)]);
    expect(both.flatMap((r) => r.subtasks.map((s) => s.name))).not.toContain('leak');
    expect(both).toHaveLength(2);
    expect(await bt.api.listTraceTasks(project, [])).toEqual([]);
  });
});
