import { describe, expect, test } from 'bun:test';
import { BUILTIN_RESOURCES, IDENTITY_HEADERS, ResourceIdSchema } from '@crewstation/contracts';
import type { Actor, UserId } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { runMigrations } from '@crewstation/persistence';
import { createProjectModule, projectMigrations } from '../wiring';

const available = await testDatabaseAvailable();
const admin: Actor = { userId: 'usr_00000000000000000000000000000002' as UserId, isAdmin: true };
const input = { name: '同名资源', cpu: '1', memory: '1Gi', maxReplicas: 2, description: 'created' };

describe.skipIf(!available)('套餐 UUIDv7 身份', () => {
  test('创建同名套餐得到不同 ID，重命名沿用 ID，更新不存在的 ID 不会创建资源', async () => {
    const tdb = await createTestDatabase([projectMigrations]);
    try {
      const module = createProjectModule({ db: tdb.db, identity: { isAdmin: async () => true, getUser: async () => undefined, findByEmail: async () => undefined },
        hosts: { prodHost: String, previewHost: String, serviceHost: String }, settings: { defaultMaxConcurrentTasks: 1, defaultServicePlan: BUILTIN_RESOURCES.servicePlanSmall } });
      const first = await module.api.createServicePlan(admin, input), second = await module.api.createServicePlan(admin, input);
      expect(ResourceIdSchema.safeParse(first.id).success).toBe(true);
      expect(first.id).not.toBe(second.id);
      expect(await module.api.updateServicePlan(admin, first.id, { ...input, name: '重新命名', cpu: '2' })).toEqual({ ...input, id: first.id, name: '重新命名', cpu: '2' });
      expect((await module.api.listServicePlans()).find((plan) => plan.id === second.id)).toEqual(second);
      await expect(module.api.updateServicePlan(admin, Bun.randomUUIDv7(), input)).rejects.toMatchObject({ kind: 'not_found' });
      await expect(module.api.updateServicePlan(admin, input.name, input)).rejects.toMatchObject({ kind: 'not_found' });
      const taskInput = { name: '同名资源', cpu: '1', memory: '1Gi', storage: '2Gi', description: '' };
      const task = await module.api.createTaskProfile(admin, taskInput);
      expect(ResourceIdSchema.safeParse(task.id).success).toBe(true);
      expect(await module.api.updateTaskProfile(admin, task.id, { ...taskInput, name: '改名' })).toEqual({ ...taskInput, id: task.id, name: '改名' });
      await expect(module.api.updateTaskProfile({ ...admin, isAdmin: false }, task.id, taskInput)).rejects.toMatchObject({ kind: 'forbidden' });
      const app = createApp({ name: 'catalog-identity-test' });
      for (const router of module.http) app.route('/', router);
      const headers = { [IDENTITY_HEADERS.userId]: admin.userId, 'content-type': 'application/json' };
      expect((await app.request('/v1/catalog/service-plans', { method: 'PUT', headers, body: JSON.stringify(input) })).status).toBe(400);
      expect((await app.request('/v1/catalog/service-plans', { method: 'POST', headers, body: JSON.stringify({ ...input, id: first.id }) })).status).toBe(409);
      expect((await app.request(`/v1/catalog/service-plans/${second.id}`, { method: 'PUT', headers, body: JSON.stringify({ ...input, name: 'HTTP 改名' }) })).status).toBe(200);
    } finally { await tdb.drop(); }
  });

  test('旧库同名主键升级为独立 ID，保留原资源值与可追溯映射，重跑不会重新编号', async () => {
    const old = { ...projectMigrations, files: projectMigrations.files.filter((file) => Number(file.name.slice(0, 4)) < 9) };
    const tdb = await createTestDatabase([old]);
    try {
      await tdb.db.execute("INSERT INTO project.service_plans VALUES ('custom', '250m', '256Mi', 1, 'preserved')");
      await runMigrations(tdb.db, [projectMigrations]);
      const rows = await tdb.db.execute("SELECT id, name, cpu, description FROM project.service_plans WHERE name = 'custom'") as unknown as { id: string; name: string; cpu: string; description: string }[];
      expect(rows).toHaveLength(1);
      expect(ResourceIdSchema.safeParse(rows[0]!.id).success).toBe(true);
      expect(rows[0]).toMatchObject({ name: 'custom', cpu: '250m', description: 'preserved' });
      expect([...(await tdb.db.execute("SELECT id FROM project.resource_identity_aliases WHERE kind = 'service-plan' AND key = '[\"custom\"]'"))]).toEqual([{ id: rows[0]!.id }]);
      expect(await runMigrations(tdb.db, [projectMigrations])).toEqual([]);
    } finally { await tdb.drop(); }
  });
});
