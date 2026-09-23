import { describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { CreateComputeProfileRequestSchema, ResourceIdSchema } from '@crewstation/contracts';
import type { Actor, UserId } from '@crewstation/contracts';
import { identityMigrations } from '@crewstation/module-identity';
import { queueMigrations } from '@crewstation/queue';
import { generateSecretKey } from '@crewstation/secretbox';
import { runMigrations } from '@crewstation/persistence';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { createAgentRuntimeModule, agentRuntimeMigrations } from '../wiring';

const available = await testDatabaseAvailable();
const actor: Actor = { userId: '01a0bf5d-8f4b-7c11-8122-000000000002' as UserId, isAdmin: true };
const layout = { pullBase: 'registry.cs.svc:5000', pushHost: 'registry.cs.localhost', baseRepository: 'crewstation/task-runtime', runtimePrefix: 'runtime/' };

describe.skipIf(!available)('算力档位 UUIDv7', () => {
  test('名称可重用和修改；凭据按 ID 写入，复制分配新子资源，固定修订可继续启动', async () => {
    const tdb = await createTestDatabase([queueMigrations, agentRuntimeMigrations]);
    try {
      const module = createAgentRuntimeModule({ taskProfiles: { exists: async () => true }, db: tdb.db, isAdmin: async () => true,
        settings: { secretKeyBase64: generateSecretKey(), registry: { ...layout, scheme: 'http', baseTag: 'dev' } },
        registry: { layout, resolveDigest: async () => `sha256:${'1'.repeat(64)}` }, references: { listReferencingProjects: async () => [] },
        executor: { run: async () => ({ state: 'passed', outcome: 'passed', stages: [] }) } });
      const credentialId = Bun.randomUUIDv7(), stepId = Bun.randomUUIDv7();
      const input = CreateComputeProfileRequestSchema.parse({ name: '展示名称', content: { image: 'runtime/claude:1', launch: { protocol: 'claude-code', binaryPath: '/bin/claude' },
        secrets: [{ id: credentialId, name: 'TOKEN' }], steps: [{ kind: 'file', stepId, name: '配置文件', pathTemplate: '{{agent.home}}/config', contentTemplate: '{{secrets.TOKEN}}' }] },
        credentials: { [credentialId]: { op: 'replace', value: 'example-value' } } });
      const created = await module.api.createProfile(actor, input);
      expect(ResourceIdSchema.safeParse(created.id).success).toBe(true);
      expect(created.credentials[0]).toMatchObject({ id: credentialId, name: 'TOKEN', set: true });
      await module.api.runQueuedTest(created.latestTest!.testId, async () => true);
      await module.api.setDefault(actor, created.id);
      expect(await module.api.resolve({ kind: 'default' }, 'agent')).toMatchObject({ id: created.id, name: '展示名称' });
      const saved = await module.api.saveProfile(actor, created.id, { expectedRevision: 1, name: '新名称', content: created.content, credentials: {} });
      expect(saved).toMatchObject({ id: created.id, name: '新名称', revision: 1 });
      expect(saved.latestTest!.testId).toBe(created.latestTest!.testId);
      const copied = await module.api.copyProfile(actor, created.id, { name: '新名称' });
      expect(copied.id).not.toBe(created.id);
      expect(copied.content.steps[0]!.stepId).not.toBe(stepId);
      expect(copied.content.secrets[0]!.id).not.toBe(credentialId);
      expect(copied.credentials[0]!.set).toBe(true);
      await expect(module.api.getProfile(actor, '新名称')).rejects.toMatchObject({ kind: 'not_found' });
      const material = await module.api.launchMaterial({ profileId: created.id, revision: 1 });
      expect(material.beforeStart.secrets).toEqual({ TOKEN: 'example-value' });
      expect(material.beforeStart.profile).toBe(created.id);
      await expect(module.api.createProfile(actor, input)).rejects.toMatchObject({ kind: 'conflict' });
      expect((await module.api.listProfiles(actor)).items).toHaveLength(2);
    } finally { await tdb.drop(); }
  });

  test('旧修订保留原内容和哈希，独立投影转换凭据声明、步骤以及被引用的步骤 ID', async () => {
    const old = { ...agentRuntimeMigrations, files: agentRuntimeMigrations.files.filter((file) => Number(file.name.slice(0, 4)) < 5) };
    const oldIdentity = { ...identityMigrations, files: identityMigrations.files.filter((file) => Number(file.name.slice(0, 4)) < 11) };
    const tdb = await createTestDatabase([oldIdentity, old]);
    try {
      await tdb.db.execute(sql`INSERT INTO identity.users (id, external_id, name, email, is_admin, created_at, last_login_at) VALUES (${actor.userId}, 'legacy-admin', 'Admin', 'admin@test.invalid', true, now(), now())`);
      const content = { secretNames: ['TOKEN'], steps: [{ stepId: 'prepare' }, { stepId: 'use', contentTemplate: '{{steps.prepare.env.TOKEN}} original prepare' }] };
      await tdb.db.execute(sql`INSERT INTO agent_runtime.profiles (name, protocol, current_revision, created_by, created_at, updated_by, updated_at) VALUES ('old', 'claude-code', 1, ${actor.userId}, now(), ${actor.userId}, now())`);
      await tdb.db.execute(sql`INSERT INTO agent_runtime.profile_revisions VALUES ('old', 1, ${JSON.stringify(content)}::text::jsonb, 'digest', 'original-hash', ${actor.userId}, now())`);
      await runMigrations(tdb.db, [identityMigrations, agentRuntimeMigrations]);
      const rows = await tdb.db.execute(sql`SELECT profile, content, normalized_content, content_hash FROM agent_runtime.profile_revisions`) as unknown as { profile: string; content: unknown; normalized_content: { secrets: { id: string; name: string }[]; steps: { stepId: string; contentTemplate?: string }[] }; content_hash: string }[];
      expect(ResourceIdSchema.safeParse(rows[0]!.profile).success).toBe(true);
      expect(rows[0]!.content).toEqual(content);
      expect(rows[0]!.content_hash).toBe('original-hash');
      const normalized = rows[0]!.normalized_content;
      expect(normalized.secrets[0]!.name).toBe('TOKEN');
      expect(ResourceIdSchema.safeParse(normalized.secrets[0]!.id).success).toBe(true);
      expect(ResourceIdSchema.safeParse(normalized.steps[0]!.stepId).success).toBe(true);
      expect(normalized.steps[1]!.contentTemplate).toBe(`{{steps.${normalized.steps[0]!.stepId}.env.TOKEN}} original prepare`);
      expect([...(await tdb.db.execute(sql`SELECT id, name, cipher_text FROM agent_runtime.profile_credentials`))]).toEqual([{ id: normalized.secrets[0]!.id, name: 'TOKEN', cipher_text: null }]);
      expect(await runMigrations(tdb.db, [identityMigrations, agentRuntimeMigrations])).toEqual([]);
    } finally { await tdb.drop(); }
  });
});
