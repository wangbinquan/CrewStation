// RFC-034 v2 模块测试的公共装配：真实 PostgreSQL + 真实 observability 模块；授权、档位目录与项目名为内存端口，时钟可拨。
import type { Actor, AgentUsageSnapshot, ProjectId, UserId } from '@crewstation/contracts';
import { createFakeK8sClient } from '@crewstation/k8s';
import { forbidden } from '@crewstation/kernel';
import { createTestDatabase } from '@crewstation/testkit';
import type { AgentCallStart } from '../api/agentCalls';
import { createObservabilityModule, observabilityMigrations } from '../wiring';

export const PROJECT_A = '01a0bf5d-8f4b-7e01-82e1-9a99060b1192' as ProjectId;
export const PROJECT_B = '01a0bf5d-8f4b-7e02-82e1-9a99060b1192' as ProjectId;
export const PROFILE = '01a0bf5d-8f4b-7e03-82e1-9a99060b1192';
export const ADMIN: Actor = { userId: '01a0bf5d-8f4b-7e04-867c-efd7527b386b' as UserId, isAdmin: true };
/** 只能看项目 A 的成员。 */
export const MEMBER: Actor = { userId: '01a0bf5d-8f4b-7e05-867c-efd7527b386b' as UserId, isAdmin: false };
export const STRANGER: Actor = { userId: '01a0bf5d-8f4b-7e06-867c-efd7527b386b' as UserId, isAdmin: false };
export const T0 = Date.parse('2026-10-14T00:00:00.000Z');
export const minutes = (value: number) => new Date(T0 + value * 60_000);

const opened: Array<() => Promise<void>> = [];
/** 每个用例建一个独立数据库；afterEach 统一删掉（用例中途失败也不遗留）。 */
export async function dropFixtures(): Promise<void> {
  for (const drop of opened.splice(0)) await drop();
}

export async function agentCallFixture() {
  const database = await createTestDatabase([observabilityMigrations]);
  opened.push(database.drop);
  const clock = { at: T0 + 24 * 60 * 60_000 }, authorized: Array<readonly [string, string, string]> = [];
  const module = createObservabilityModule({
    db: database.db, k8s: createFakeK8sClient(), isAdmin: async (id) => id === ADMIN.userId, clock: { now: () => new Date(clock.at) },
    authorizer: {
      authorize: async (actor, projectId, action) => {
        authorized.push([actor.userId, projectId, action]);
        if (!actor.isAdmin && !(actor.userId === MEMBER.userId && projectId === PROJECT_A)) throw forbidden();
      },
    },
    services: { resolveServiceOfProject: async () => undefined },
    slots: { slotRoles: async () => undefined },
    traces: {
      environments: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] },
      deliveries: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] },
      businessTasks: { list: async () => [] },
      sessions: { summarize: async () => [], events: async () => [] },
    },
    pricingProfiles: { list: async () => [{ id: PROFILE, name: 'GLM 档位', protocol: 'opencode', model: 'zhipu/glm-5' }] },
    projectNames: { names: async (ids) => new Map(ids.map((id) => [id, id === PROJECT_A ? 'Project A' : 'Project B'])) },
  });
  return { database, api: module.api, recorder: module.api.agentCalls, authorized, clock, http: module.http };
}

let sequence = 0;
/** 一次业务子任务执行的受理身份；`patch` 覆盖任意字段。 */
export function start(patch: Partial<AgentCallStart> = {}): AgentCallStart {
  sequence += 1;
  return {
    projectId: PROJECT_A, source: 'business', kind: 'subtask', taskId: 'task-1', taskLabel: 'Task 1', subtaskId: 'subtask-1', attempt: 1,
    runtimeTaskId: `runtime-${sequence}`, agentId: `agent-${sequence}`, agentKey: 'coder', agentLabel: 'Coder',
    profile: { id: PROFILE, revision: 3, name: 'GLM 档位' }, protocol: 'opencode', startedAt: minutes(0), ...patch,
  };
}

export function snapshot(state: AgentUsageSnapshot['state'], models: Array<{ model: string; input?: number; cacheRead?: number; cacheWrite?: number; output?: number; reasoning?: number }>): AgentUsageSnapshot {
  return { state, models: models.map((row) => ({ model: row.model, input: row.input ?? 0, cacheRead: row.cacheRead ?? 0, cacheWrite: row.cacheWrite ?? 0, output: row.output ?? 0, reasoning: row.reasoning ?? 0 })) };
}

export function windowOf(fromMinutes: number, toMinutes: number, tzOffset = 0) {
  return { from: minutes(fromMinutes).toISOString(), to: minutes(toMinutes).toISOString(), tzOffset };
}
