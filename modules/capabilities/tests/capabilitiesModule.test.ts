import { describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import { fixedClock } from '@crewstation/kernel';
import { createCapabilitiesModule } from '../wiring';

const projectId = '01a0bf5d-8f4b-7178-82e1-9a99060b1192' as ProjectId;
const actor: Actor = { userId: '01a0bf5d-8f4b-7793-867c-efd7527b386b' as UserId, isAdmin: false };

describe('capabilities module', () => {
  test('聚合服务的主机、约定、配置键、数据、操作与订阅', async () => {
    const { api } = createCapabilitiesModule({
      isAdmin: async () => false,
      market: { list: async () => ({ items: [] }), get: async () => { throw new Error('unused'); }, slots: async () => [] },
      projects: { list: async () => ({ items: [] }), read: async () => [], get: async () => { throw new Error('unused'); },
        session: async () => undefined, slots: async () => [], preview: async () => null, health: async () => [], releases: async () => [], switches: async () => [] },
      clock: fixedClock('2026-09-11T00:00:00Z'),
      settings: { userDomain: 'cs.localhost', serviceDomain: 'svc.cs.internal', mcp: [{ name: 'capabilities', url: 'http://mcp-capabilities.svc.cs.internal/mcp' }], defaultServicePlan: '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10' },
      sources: {
        resolveServiceOfProject: async () => ({ serviceId: '01a0bf5d-8f4b-76c5-866c-f1feda3d63bb' as ServiceId, slug: 'demo', name: 'demo', identity: 'demo/demo', namespace: 'cs-demo' }),
        authorize: async () => undefined,
        quota: async () => ({ maxConcurrentTasks: 3, running: 1 }),
        servicePlans: async () => [{ id: '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10', name: 'standard-small', cpu: '500m', memory: '512Mi', maxReplicas: 3, description: '' }],

        computeProfiles: async () => [{ id: '01a0bf5d-8f4b-780f-843c-911b2aa70862', name: 'balanced', description: '样例', terminalOnly: false, isDefault: true, available: true }, { id: '01a0bf5d-8f4b-7b73-8e41-4e3721e1e3db', name: 'tool-cli', description: '终端', terminalOnly: true, isDefault: false, available: false, reason: '档位 tool-cli 正在测试' }],
        configKeys: async (_a, _p, env) => (env === 'production' ? ['GREETING'] : ['GREETING', 'DEBUG']),
        dataResources: async () => [],
        operations: async () => [{ id: '01a0bf5d-8f4b-73dc-813d-bb1eeb744398', proxyId: '01a0bf5d-8f4b-7536-8089-304b7ad75bf8', proxy: 'issues', method: 'GET', path: '/v1/issues/{id}', openPolicy: 'default', granted: true }],
        subscriptions: async () => [],
        identityForwarding: async () => ({ projectId, source: 'global' as const, fields: ['name'], headers: ['x-cs-identity-token', 'x-cs-user-id', 'x-cs-user-name'], tokenClaims: ['name'] }),
      },
    });
    const dto = await api.describe(actor, projectId);
    expect(dto.hosts.dev).toBe('dev.demo.cs.localhost');
    expect(dto.conventions.identityHeaders['userId']).toBe('x-cs-user-id');
    // 能力说明给的是**当前生效**的转发集，而不是静态常量表（RFC-005 B10）。
    expect(dto.identityForwarding).toMatchObject({ source: 'global', fields: ['name'] });
    expect(dto.identityForwarding.headers).not.toContain('x-cs-user-email');
    expect(dto.config).toEqual({ development: ['GREETING', 'DEBUG'], production: ['GREETING'] });
    expect(dto.operations[0]?.granted).toBe(true);
    expect(dto.plan?.name).toBe('standard-small');
    // 租户只看到档位名、说明、是否仅终端、是否默认与可用性，看不到镜像、二进制或模型（RFC-006 C2）。
    expect(dto.computeProfiles.map((p) => [p.name, p.isDefault, p.terminalOnly, p.available])).toEqual([['balanced', true, false, true], ['tool-cli', false, true, false]]);
    expect(JSON.stringify(dto.computeProfiles)).not.toMatch(/image|binaryPath|model/);
    expect(dto.businessTaskApi.length).toBeGreaterThan(3);
  });
});
