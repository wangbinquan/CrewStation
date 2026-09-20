import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Actor, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import { fixedClock } from '@crewstation/kernel';
import { createCapabilitiesModule } from '../wiring';

const projectId = '01a0bf5d-8f4b-7178-82e1-9a99060b1192' as ProjectId;
const actor: Actor = { userId: '01a0bf5d-8f4b-7793-867c-efd7527b386b' as UserId, isAdmin: false };
const unused = async (): Promise<never> => { throw new Error('unused'); };

async function describedBusinessTaskApi(): Promise<string[]> {
  const { api } = createCapabilitiesModule({
    isAdmin: async () => false,
    market: { list: async () => ({ items: [] }), get: unused, slots: async () => [] },
    projects: { list: async () => ({ items: [] }), read: async () => [], get: unused, session: async () => undefined, slots: async () => [], preview: async () => null, health: async () => [], releases: async () => [], switches: async () => [] },
    clock: fixedClock('2026-09-20T00:00:00Z'),
    settings: { userDomain: 'cs.localhost', serviceDomain: 'svc.cs.internal', mcp: [], defaultServicePlan: '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10' },
    sources: {
      resolveServiceOfProject: async () => ({ serviceId: '01a0bf5d-8f4b-76c5-866c-f1feda3d63bb' as ServiceId, slug: 'demo', name: 'demo', identity: 'demo/demo', namespace: 'cs-demo' }),
      authorize: async () => undefined, quota: async () => ({ maxConcurrentTasks: 1, running: 0 }), servicePlans: async () => [], computeProfiles: async () => [],
      configKeys: async () => [], dataResources: async () => [], operations: async () => [], subscriptions: async () => [],
      identityForwarding: async () => ({ projectId, source: 'global' as const, fields: [], headers: [], tokenClaims: [] }),
    },
  });
  return (await api.describe(actor, projectId)).businessTaskApi.map((entry) => `${entry.method} ${entry.path}`);
}

/** business-task 的服务域路由字面值；能力说明是只读描述，不 import 那个模块的内部文件，所以按源码文本对账。 */
function realServiceRoutes(): Set<string> {
  const source = readFileSync(resolve(import.meta.dir, '..', '..', 'business-task', 'http', 'serviceRoutes.ts'), 'utf8');
  return new Set([...source.matchAll(/\br\.(get|post|put|patch|delete)\('([^']+)'/g)].map((match) => `${match[1]!.toUpperCase()} ${match[2]!.replace(/:(\w+)/g, '{$1}')}`));
}

describe('能力说明里的业务任务 API 表', () => {
  // 这张表是给业务开发者和容器里的 Agent 看的第二份描述：路由改了而表没改，他们照着表写出来的调用就是 404。
  test('表里的每一条都是 business-task 真实存在的服务域路由', async () => {
    const described = await describedBusinessTaskApi();
    const real = realServiceRoutes();
    expect(real.size).toBeGreaterThan(5);
    expect(described.length).toBeGreaterThan(3);
    expect(described.filter((entry) => !real.has(entry))).toEqual([]);
  });
});
