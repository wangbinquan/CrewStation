import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId } from '@crewstation/contracts';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { createDataControlModule, dataControlMigrations } from '@crewstation/module-data-control';
import { createTestDatabase, testDatabaseAvailable, type TestDatabase } from '@crewstation/testkit';
import { rotateDataCredential } from '../application/credentialRotation';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';

const available = await testDatabaseAvailable();
const projectId = '01a0bf5d-8f4b-7178-82e1-9a99060b14ff' as ProjectId;
describe.skipIf(!available)('I31：轮换与启动共享项目锁，失败意图持久保留', () => {
  let db: TestDatabase;
  beforeAll(async () => { db = await createTestDatabase([resourcesMigrations, dataControlMigrations]); });
  afterAll(async () => { await db.drop(); });
  test('已有使用者拒绝；SQL 已改而事务失败，重试沿用原口令；轮换中不发凭据、不受理新启动', async () => {
    const resources = createResourcesModule({ db: db.db, quotas: { limitFor: async () => 10 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
    const record = await resources.api.owner('data').declare({ kind: 'database', ref: 'rotation', projectId, spec: { children: [{ kind: 'PostgresRole', name: 'cs_rotate' }, { kind: 'PostgresDatabase', name: 'cs_rotate' }] } });
    const received: string[] = [];
    let fail = true;
    const control = createDataControlModule({ db: db.db, secretKeyBase64: Buffer.alloc(32, 5).toString('base64'),
      ledger: { get: resources.api.get, listLive: async () => [], latestChange: async () => 0, changesSince: async () => [], observe: async () => ({ status: 'unchanged' }) },
      plane: { snapshot: async () => ({ databases: new Map(), roles: new Map(), observedAt: new Date().toISOString() }), close: async () => {}, dropRole: async () => 'absent', ensureDatabase: async () => {}, ensureTemporaryRole: async () => {},
        rotatePassword: async ({ password }) => { received.push(password); if (fail) throw new Error('模拟 SQL 成功后回执丢失'); },
      },
    });
    const writer = resources.api.owner('task-runtime');
    const input = { kind: 'dev-workspace' as const, ref: 'consumer', projectId, spec: { children: [] } };
    const workload = await writer.admit(input);
    await expect(rotateDataCredential(resources.api, control.api, record.id, projectId)).rejects.toThrow('使用者');
    expect(received).toHaveLength(0);
    await writer.requestRelease(workload.id, { code: 'ended', message: '已结束' });
    await expect(rotateDataCredential(resources.api, control.api, record.id, projectId)).rejects.toThrow('回执丢失');
    expect((await resources.api.get(record.id))?.conditions).toContainEqual(expect.objectContaining({ type: 'CredentialRotating', status: 'true' }));
    await expect(control.api.credentialOf(record.id)).rejects.toThrow('正在轮换');
    await expect(writer.admit({ ...input, ref: 'new' })).rejects.toThrow('正在轮换');
    await expect(writer.declare({ ...input, kind: 'service-slot', ref: 'slot' })).rejects.toThrow('正在轮换');
    fail = false;
    await rotateDataCredential(resources.api, control.api, record.id, projectId);
    expect(received).toHaveLength(2);
    expect(received[1]).toBe(received[0]);
    expect((await control.api.credentialOf(record.id))?.password).toBe(received[0]);
    expect(JSON.stringify(await resources.api.get(record.id))).not.toContain(received[0]!);
    expect((await writer.admit({ ...input, ref: 'after' })).desired).toBe('present');
  });
  test('空闲检查进行时并发启动等待同一项目锁，意图提交后该启动被拒绝', async () => {
    const other = '01a0bf5d-8f4b-7178-82e1-9a99060b14fe' as ProjectId;
    const resources = createResourcesModule({ db: db.db, quotas: { limitFor: async () => 10 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
    const database = await resources.api.owner('data').declare({ kind: 'database', ref: 'concurrent-rotation', projectId: other, spec: { children: [] } });
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const rotation = resources.api.withIdleProject(other, async (tx) => {
      entered(); await hold;
      await resources.api.owner('data').within(tx).report(database.id, { conditions: [{ type: 'CredentialRotating', status: 'true' }] });
    });
    await started;
    const admission = resources.api.owner('task-runtime').admit({ kind: 'dev-workspace', ref: 'racing-start', projectId: other, spec: { children: [] } }).then(() => 'accepted', (error: Error) => error.message);
    try { expect(await Promise.race([admission, Bun.sleep(30).then(() => 'waiting')])).toBe('waiting'); } finally { release(); }
    await rotation;
    expect(await admission).toContain('正在轮换');
  });

  test('数据库准入覆盖两段事务和实际回调，seal 只能在口令与台账条件完整提交后返回', async () => {
    const id = Bun.randomUUIDv7() as ProjectId;
    const resources = createResourcesModule({ db: db.db, quotas: { limitFor: async () => 10 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
    const record = await resources.api.owner('data').declare({ kind: 'database', ref: 'native-rotation-admission', projectId: id, spec: { children: [{ kind: 'PostgresRole', name: 'cs_native_rotation' }] } });
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const control = createDataControlModule({ db: db.db, secretKeyBase64: Buffer.alloc(32, 6).toString('base64'),
      ledger: { get: resources.api.get, listLive: async () => [], latestChange: async () => 0, changesSince: async () => [], observe: async () => ({ status: 'unchanged' }) },
      plane: { snapshot: async () => ({ databases: new Map(), roles: new Map(), observedAt: new Date().toISOString() }), close: async () => {}, dropRole: async () => 'absent', ensureDatabase: async () => {}, ensureTemporaryRole: async () => {}, rotatePassword: async () => { entered.resolve(); await release.promise; } },
    });
    const rotating = rotateDataCredential(resources.api, control.api, record.id, id); await entered.promise;
    let sealed = false;
    const sealing = withExclusiveDatabaseAdmission(db.db, 'data-control.project-admission:' + id, async () => {
      sealed = true;
      expect((await resources.api.get(record.id))?.conditions).toContainEqual(expect.objectContaining({ type: 'CredentialRotating', status: 'false' }));
      const [stored] = await db.db.execute<{ pending_box: string | null }>("SELECT pending_box FROM data_control.credentials WHERE resource_id='" + record.id + "'");
      expect(stored?.pending_box).toBeNull();
    });
    try { await Bun.sleep(30); expect(sealed).toBe(false); }
    finally { release.resolve(); await rotating; await sealing; await control.observer.stop(); }
    expect(sealed).toBe(true);
    expect((await control.api.credentialOf(record.id))?.password).toBeString();
  }, 10000);
});
