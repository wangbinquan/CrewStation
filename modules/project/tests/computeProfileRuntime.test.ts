import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Actor, RuntimeConfigId, UserId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createIdentityModule, identityMigrations } from '@crewstation/module-identity';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import type { RuntimeConfigSummary } from '../domain/plans';
import type { ProjectModule } from '../wiring';
import { createProjectModule, projectMigrations } from '../wiring';

const available = await testDatabaseAvailable();
let tdb: TestDatabase;
let project: ProjectModule;
let admin: Actor;
const configId = 'arc_0123456789abcdef0123456789abcdef' as RuntimeConfigId;
const directory = new Map<string, RuntimeConfigSummary>();
const hosts = { prodHost: (s: string) => `${s}.cs.localhost`, previewHost: (s: string) => `preview.${s}.cs.localhost`, serviceHost: (s: string) => `${s}.svc.cs.internal` };

beforeAll(async () => {
  if (!available) return;
  tdb = await createTestDatabase([eventbusMigrations, identityMigrations, projectMigrations]);
  const identity = createIdentityModule({ db: tdb.db, settings: { adminEmails: [] } });
  const a = await identity.api.ensureUser({ externalId: 'demo:admin2', name: 'Admin', email: 'admin2@example.com' });
  admin = { userId: a.id as UserId, isAdmin: true };
  project = createProjectModule({ db: tdb.db, identity: identity.api, hosts, runtimeConfigs: { describe: async (id) => directory.get(id) }, settings: { defaultMaxConcurrentTasks: 3, defaultServicePlan: 'standard-small' } });
});
afterAll(async () => { await tdb?.drop(); });

describe.skipIf(!available)('算力档位的运行环境绑定（RFC-004）', () => {
  test('绑定要校验引用与驱动；托管档位写入必须带版本；版本不符报冲突；租户投影给出可用性与原因', async () => {
    const base = { name: 'gateway', driver: 'opencode' as const, model: 'anthropic/claude-x', description: '网关' };
    await expect(project.api.upsertComputeProfile(admin, { ...base, runtimeConfigId: configId })).rejects.toMatchObject({ kind: 'not_found' });
    directory.set(configId, { id: configId, name: 'opencode-gateway', driver: 'claude-code', enabled: true, activeRevision: 3 });
    await expect(project.api.upsertComputeProfile(admin, { ...base, runtimeConfigId: configId })).rejects.toMatchObject({ kind: 'validation' });
    directory.set(configId, { id: configId, name: 'opencode-gateway', driver: 'opencode', enabled: true, activeRevision: null });
    const bound = await project.api.upsertComputeProfile(admin, { ...base, runtimeConfigId: configId });
    expect(bound).toMatchObject({ revision: 1, runtimeConfigId: configId });
    // 旧客户端不带 expectedRevision 写托管档位：拒绝，不清掉绑定。
    await expect(project.api.upsertComputeProfile(admin, base)).rejects.toMatchObject({ kind: 'precondition', details: { code: 'compute_profile_managed', revision: 1 } });
    await expect(project.api.upsertComputeProfile(admin, { ...base, runtimeConfigId: configId, expectedRevision: 0 })).rejects.toMatchObject({ kind: 'conflict' });
    expect(await project.api.resolveComputeProfile('gateway')).toMatchObject({ runtimeConfigId: configId, revision: 1 });
    expect(await project.api.listComputeProfilesReferencing(configId)).toEqual(['gateway']);

    let summary = (await project.api.listComputeProfiles()).find((p) => p.name === 'gateway')!;
    expect(summary).toMatchObject({ mode: 'managed', available: false });
    expect(summary.reason).toContain('尚未启用');
    directory.set(configId, { id: configId, name: 'opencode-gateway', driver: 'opencode', enabled: false, activeRevision: 3 });
    summary = (await project.api.listComputeProfiles()).find((p) => p.name === 'gateway')!;
    expect(summary.reason).toContain('已停用');
    directory.set(configId, { id: configId, name: 'opencode-gateway', driver: 'opencode', enabled: true, activeRevision: 3 });
    expect((await project.api.listComputeProfiles()).find((p) => p.name === 'gateway')).toEqual({ name: 'gateway', description: '网关', mode: 'managed', available: true });
    const full = (await project.api.listComputeProfilesFull(admin)).find((p) => p.name === 'gateway')!;
    expect(full.runtime).toEqual({ configName: 'opencode-gateway', driver: 'opencode', enabled: true, activeRevision: 3, ready: true });
    directory.delete(configId);
    expect((await project.api.listComputeProfiles()).find((p) => p.name === 'gateway')?.reason).toContain('不存在');

    // 带正确版本可以改回部署配置模式；revision 递增。
    const unbound = await project.api.upsertComputeProfile(admin, { ...base, expectedRevision: 1 });
    expect(unbound).toMatchObject({ revision: 2 });
    expect(unbound.runtimeConfigId).toBeUndefined();
    expect((await project.api.listComputeProfiles()).find((p) => p.name === 'gateway')).toMatchObject({ mode: 'legacy', available: true });
  });
});
