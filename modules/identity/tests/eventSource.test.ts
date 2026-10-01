import { afterEach, describe, expect, test } from 'bun:test';
import { ProjectIdSchema, ServiceIdSchema, TOKEN_CLAIMS } from '@crewstation/contracts';
import type { WorkloadIdentity } from '@crewstation/contracts';
import { verifyWithJwks } from '@crewstation/jwt';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { TestDatabase } from '@crewstation/testkit';
import { createIdentityModule, identityMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let database: TestDatabase;
afterEach(async () => { await database?.drop(); });

describe.skipIf(!available)('原事件来源签名（真实 PG / ForwardAuth）', () => {
  test('服务、开发及业务均签原 UUID 与 Pod，事件固定受众验签；平台调用保持、其他受众不能冒充事件入口', async () => {
    database = await createTestDatabase([identityMigrations]);
    const scope = { projectId: ProjectIdSchema.parse(Bun.randomUUIDv7()), serviceId: ServiceIdSchema.parse(Bun.randomUUIDv7()) };
    let current: WorkloadIdentity = { identity: 'original/original', project: 'original', service: 'original', kind: 'service', pod: { uid: 'original-pod', name: 'source', namespace: 'cs-original', ip: '10.1.2.3' } };
    let targetIdentity = 'platform:events', owner: typeof scope | undefined = scope, open = true;
    const identity = createIdentityModule({ db: database.db, settings: { adminEmails: [] },
      workloadLookup: { byIp: async (ip) => ip === '10.1.2.3' ? current : undefined }, workloadOwnership: { resolve: async () => owner },
      projectLifecycle: { available: async (id) => id === scope.projectId && open },
      allowlistEvaluator: { evaluate: async () => ({ allowed: true, targetIdentity }) } });
    const sign = async () => {
      const result = await identity.api.authorizeServiceRequest({ host: 'events.svc.test', method: 'POST', uri: '/v1/events/produce', forwardedFor: '10.1.2.3' });
      expect(result.kind).toBe('allow'); if (result.kind !== 'allow') throw new Error('Original fixture denied'); return result.injected.sourceToken;
    };
    for (const kind of ['service', 'dev-session', 'business-task'] as const) {
      current = { ...current, kind };
      const token = await sign(), verified = await verifyWithJwks(token, await identity.api.jwks(), { issuer: TOKEN_CLAIMS.issuer, audience: 'service:platform:events' });
      expect(verified.claims).toMatchObject({ [TOKEN_CLAIMS.sourceProjectId]: scope.projectId, [TOKEN_CLAIMS.sourceServiceId]: scope.serviceId, [TOKEN_CLAIMS.sourcePodUid]: 'original-pod', [TOKEN_CLAIMS.kind]: kind });
      expect(await identity.api.resolveEventSource(token)).toMatchObject(scope);
    }
    current = { ...current, kind: 'service' };
    const originalToken = await sign();
    targetIdentity = 'platform-api'; expect(await identity.api.resolveEventSource(await sign())).toBeUndefined();
    expect(await identity.api.resolveEventSource('forged')).toBeUndefined();
    current = { ...current, pod: { ...current.pod!, uid: 'replacement-pod' } }; expect(await identity.api.resolveEventSource(originalToken)).toBeUndefined();
    current = { ...current, pod: { ...current.pod!, uid: 'original-pod' } };
    owner = { projectId: ProjectIdSchema.parse(Bun.randomUUIDv7()), serviceId: scope.serviceId }; expect(await identity.api.resolveEventSource(originalToken)).toBeUndefined();
    owner = { projectId: scope.projectId, serviceId: ServiceIdSchema.parse(Bun.randomUUIDv7()) }; expect(await identity.api.resolveEventSource(originalToken)).toBeUndefined();
    owner = scope; open = false; expect(await identity.api.resolveEventSource(originalToken)).toBeUndefined();
    expect((await identity.api.authorizeServiceRequest({ host: 'events.svc.test', method: 'POST', uri: '/', forwardedFor: '10.1.2.3' })).kind).toBe('forbidden');
    open = true; owner = undefined;
    expect((await identity.api.authorizeServiceRequest({ host: 'events.svc.test', method: 'POST', uri: '/', forwardedFor: '10.1.2.3' })).kind).toBe('forbidden');
    current = { ...current, kind: 'platform', project: 'platform', service: 'auth', identity: 'platform/auth' };
    expect(await identity.api.resolveEventSource(await sign())).toBeUndefined();
  }, 15000);
});
