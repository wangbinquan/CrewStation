import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId, TaskId, TraceId } from '@crewstation/contracts';
import { newId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleEnvironmentRepository } from '../adapters/persistence/drizzleRepositories';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import { rebuildFixture } from './rebuildFixture';

const available = await testDatabaseAvailable();
let f: Awaited<ReturnType<typeof rebuildFixture>>;
const project = '01a0bf5d-8f4b-7a01-8b88-18362617594b' as ProjectId, other = '01a0bf5d-8f4b-7a02-8b88-18362617594b' as ProjectId;
const service = '01a0bf5d-8f4b-7a03-8856-e078a980dc2f' as ServiceId;
const trace = (n: number) => n.toString(16).padStart(32, '0') as TraceId;
const at = (minute: number, ms = 0) => new Date(Date.UTC(2026, 8, 23, 10, minute, 0, ms));

function env(input: { traceId: TraceId; created: Date; projectId?: ProjectId; kind?: TaskEnvironment['kind']; state?: TaskEnvironment['state']; activity?: Date; parent?: TaskId }): TaskEnvironment {
  const id = newId('task') as TaskId;
  return {
    id, projectId: input.projectId ?? project, serviceId: service, kind: input.kind ?? 'dev-session', state: input.state ?? 'released', volumeMode: 'follow-container', profile: 'coding-medium',
    namespace: 'cs-trace', podName: `task-${id.slice(-12)}`, pvcName: `work-${id.slice(-12)}`, traceId: input.traceId, runnerTokenHash: 'hash', connected: false, labels: {},
    createdAt: input.created, updatedAt: input.activity ?? input.created, lastActivityAt: input.activity ?? input.created,
    ...(input.parent ? { native: { purpose: 'cli', parentTaskId: input.parent, parentPodUid: 'pod', pvcUid: 'pvc', nodeName: 'n', agentId: 'agent-1', runnerId: 'runner-1', fingerprint: 'f',
      requestedProfile: null, profile: { id: 'p', name: 'coding-medium', cpu: '1', memory: '2Gi', storage: '10Gi' }, image: 'task:current', state: 'finished' } } : {}),
  };
}

let session: TaskEnvironment;
beforeAll(async () => {
  if (!available) return;
  f = await rebuildFixture({ running: true });
  const repo = drizzleEnvironmentRepository(f.tdb.db);
  session = env({ traceId: trace(1), created: at(0), state: 'running', activity: at(30) });
  const rows = [
    session,
    env({ traceId: trace(1), created: at(5), parent: session.id, activity: at(9) }),
    env({ traceId: trace(2), created: at(10), kind: 'business', state: 'released', activity: at(12) }),
    // 同一毫秒开始的两条链靠 traceId 排定先后，翻页不丢不重。
    env({ traceId: trace(3), created: at(20, 500), kind: 'business', state: 'failed', activity: at(21) }),
    env({ traceId: trace(4), created: at(20, 500), kind: 'business', state: 'released', activity: at(22) }),
    // 同一个 traceId 在别的项目里的记录（事件扇出给多个订阅项目时就会这样），以及档位测试，都不算本项目的链。
    env({ traceId: trace(2), created: at(1), projectId: other, kind: 'business' }),
    env({ traceId: trace(9), created: at(40), kind: 'profile-test' }),
  ];
  for (const row of rows) await repo.insert(row);
});
afterAll(async () => { await f?.close(); });

describe.skipIf(!available)('调用链查询（task-runtime）', () => {
  test('按 traceId 分组、按开始时间倒序：别的项目与档位测试不算，同一毫秒按 traceId 排', async () => {
    const keys = await f.runtime.api.traceKeys(project, { limit: 10 });
    expect(keys.map((k) => k.traceId)).toEqual([trace(4), trace(3), trace(2), trace(1)]);
    expect(keys.at(-1)).toEqual({ traceId: trace(1), firstAt: at(0).toISOString(), lastAt: at(30).toISOString(), active: true });
    // trace(2) 在别的项目里 10:01 就开始了，本项目只看自己的那部分。
    expect(keys.find((k) => k.traceId === trace(2))).toEqual({ traceId: trace(2), firstAt: at(10).toISOString(), lastAt: at(12).toISOString(), active: false });
  });

  test('按上一页最后一条的 (开始时间, traceId) 翻页', async () => {
    const first = await f.runtime.api.traceKeys(project, { limit: 1 });
    expect(first.map((k) => k.traceId)).toEqual([trace(4)]);
    const second = await f.runtime.api.traceKeys(project, { limit: 2, before: { at: first[0]!.firstAt, traceId: first[0]!.traceId } });
    expect(second.map((k) => k.traceId)).toEqual([trace(3), trace(2)]);
    const last = await f.runtime.api.traceKeys(project, { limit: 2, before: { at: second[1]!.firstAt, traceId: second[1]!.traceId } });
    expect(last.map((k) => k.traceId)).toEqual([trace(1)]);
  });

  test('有活动的链：仍在进行的不看时间，其余看最后活动时间', async () => {
    expect((await f.runtime.api.activeTraceIds(project, at(21, 500).toISOString())).sort()).toEqual([trace(1), trace(4)]);
    expect(await f.runtime.api.activeTraceIds(project, at(59).toISOString())).toEqual([trace(1)]);
  });

  test('按 trace 取环境只取本项目的，带 Agent 执行与最后一次状态变化的时间', async () => {
    const rows = await f.runtime.api.listTraceEnvironments(project, [trace(1), trace(2)]);
    expect(rows.map((r) => [r.traceId, r.kind, r.native?.purpose ?? 'root'])).toEqual([[trace(1), 'dev-session', 'root'], [trace(1), 'dev-session', 'cli'], [trace(2), 'business', 'root']]);
    expect(rows[1]).toMatchObject({ updatedAt: at(9).toISOString(), native: { parentTaskId: session.id, state: 'finished', profile: { name: 'coding-medium' } } });
    expect(await f.runtime.api.listTraceEnvironments(project, [])).toEqual([]);
    expect(await f.runtime.api.listTraceEnvironments(other, [trace(1)])).toEqual([]);
  });
});
