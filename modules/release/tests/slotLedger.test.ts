import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { ProjectId, ReleaseId, ServiceId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import type { Logger } from '@crewstation/kernel';
import type { ResourcesModule } from '@crewstation/module-resources';
import { createResourcesModule, resourcesMigrations } from '@crewstation/module-resources';
import { queueMigrations } from '@crewstation/queue';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { loadSlotDtos } from '../application/queries';
import { resyncSlotLedger } from '../application/slotLedgerResync';
import { initialSlots, withSlot } from '../domain/slots';
import type { SlotLedger } from '../ports/ledger';
import { slotLedgerResyncWorker } from '../workers/slotLedgerResync';
import { releaseMigrations } from '../wiring';

const available = await testDatabaseAvailable();
const projectId = '01a0bf5d-8f4b-7710-89f8-83b88c835ea7' as ProjectId;
const serviceId = '01a0bf5d-8f4b-7aea-8983-7b41e8b30564' as ServiceId, later = '01a0bf5d-8f4b-7aea-8983-7b41e8b30565' as ServiceId;
const releaseId = '01a0bf5d-8f4b-7aea-8983-7b41e8b3a001' as ReleaseId;
const now = new Date('2026-09-23T12:00:00.000Z');

describe.skipIf(!available)('服务槽投影进资源台账（RFC-025 第三期）', () => {
  let database: TestDatabase;
  let resources: ResourcesModule;
  let ledger: SlotLedger;
  const warnings: string[] = [];
  const logger: Logger = { debug: () => undefined, info: () => undefined, warn: (msg) => { warnings.push(msg); }, error: () => undefined, child: () => logger };
  const services = { resolveServiceById: async (id: ServiceId) => ({ projectId, slug: id === serviceId ? 'demo' : 'later', name: id === serviceId ? 'demo' : 'later', namespace: 'cs-demo' }) };
  const slotRecord = async (id: ServiceId, physical: string) => (await resources.api.list({ kind: 'service-slot', includeStopped: true })).find((record) => record.owner.ref === `${id}/${physical}`);

  beforeAll(async () => {
    database = await createTestDatabase([eventbusMigrations, queueMigrations, resourcesMigrations, releaseMigrations]);
    resources = createResourcesModule({ db: database.db, quotas: { limitFor: async () => 4 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true });
    ledger = { within: (tx) => resources.api.owner('release').within(tx as object) };
  });
  afterAll(async () => { await database.drop(); });

  test('保存槽即在同一事务里写两条记录：尚未部署是已结束；部署后照 Deployment 的观测推进到运行中；下线后先结束中、Deployment 没了是已结束', async () => {
    const uow = drizzleUnitOfWork(database.db, { ledger, services, logger });
    await uow.run(async (scope) => {
      await scope.releases.insert({ id: releaseId, serviceId, projectId, tag: 'v0.1.0', commitSha: 'a'.repeat(40), branch: 'main', status: 'deploying', targetSlot: 'green', pipeline: { step: 3 }, createdBy: '01a0bf5d-8f4b-7210-80c1-302ae945a901' as never, createdAt: now, updatedAt: now });
      await scope.slots.initialize(initialSlots(serviceId, now));
    });
    expect(await slotRecord(serviceId, 'green')).toMatchObject({ phase: 'stopped', reason: { code: 'not-deployed', message: '尚未部署' }, display: { physical: 'green', role: 'preview' } });
    await uow.run(async (scope) => {
      const slots = (await scope.slots.get(serviceId))!;
      await scope.slots.save(withSlot(slots, { physical: 'green', releaseId, state: 'deploying', replicas: 1, readyReplicas: 0, updatedAt: now }, now));
    });
    const green = (await slotRecord(serviceId, 'green'))!;
    expect(green).toMatchObject({ phase: 'provisioning', display: { releaseId, tag: 'v0.1.0' }, children: [{ kind: 'Deployment', namespace: 'cs-demo', name: 'demo-green', phase: 'absent' }, { kind: 'Service', namespace: 'cs-demo', name: 'demo-green', phase: 'absent' }] });
    // 槽的 Service 由记录认领（RFC-025 T14）；下线时它照旧保留，不影响「已结束」的判定。
    await resources.api.observe({ child: { kind: 'Service', namespace: 'cs-demo', name: 'demo-green', uid: 'uid-svc-green', phase: 'Present', ready: true } });
    const deployment = (phase: string) => ({ child: { kind: 'Deployment', namespace: 'cs-demo', name: 'demo-green', uid: 'uid-demo-green', phase, ready: phase === 'Available', reason: '副本 0／1 就绪' } });
    await resources.api.observe(deployment('Progressing'));
    expect((await resources.api.get(green.id))?.phase).toBe('starting');
    await resources.api.observe(deployment('Available'));
    expect((await resources.api.get(green.id))?.phase).toBe('ready');
    const at = new Date('2026-09-23T13:00:00.000Z');
    await uow.run(async (scope) => {
      const slots = (await scope.slots.get(serviceId))!;
      await scope.slots.save(withSlot(slots, { physical: 'green', state: 'empty', replicas: 0, readyReplicas: 0, updatedAt: at, offline: { releaseId, at, reason: 'manual', workloadRemoved: false } }, at));
    });
    expect(await resources.api.get(green.id)).toMatchObject({ phase: 'stopping', reason: { code: 'offline-manual', message: '已由成员手动下线' } });
    await resources.api.observe({ ...deployment('Available'), gone: true });
    expect(await resources.api.get(green.id)).toMatchObject({ phase: 'stopped', desired: 'present', reason: { code: 'offline-manual' } });
    expect(warnings).toEqual([]);
  });

  test('补投影：台账接上之前就有的槽由它第一次写进台账；台账写失败只记告警，不挡住槽的保存', async () => {
    await drizzleUnitOfWork(database.db).run((scope) => scope.slots.initialize(initialSlots(later, now)));
    expect(await slotRecord(later, 'blue')).toBeUndefined();
    const uow = drizzleUnitOfWork(database.db, { ledger, services, logger });
    expect(await resyncSlotLedger(uow, logger)).toBeGreaterThanOrEqual(1);
    expect(await slotRecord(later, 'blue')).toMatchObject({ phase: 'stopped', display: { role: 'prod' } });
    const broken = drizzleUnitOfWork(database.db, { ledger: { within: () => ({ declare: async () => { throw new Error('台账暂时不可用'); }, find: async () => { throw new Error('台账暂时不可用'); }, report: async () => { throw new Error('台账暂时不可用'); } }) }, services, logger });
    await broken.run(async (scope) => { await scope.slots.save({ ...(await scope.slots.get(later))!, updatedAt: now }); });
    expect(warnings).toContain('resource ledger slot projection failed');
    // 读台账失败当作没有记录：槽的旧接口照流水线的状态给出，不报错。
    expect(await broken.read.ledger?.slot(later, 'blue')).toBeUndefined();
  });

  test('槽的旧接口状态：流水线判定就绪之后照台账的观测——副本后来没全就绪是降级；流水线推进中以流水线为准', async () => {
    const uow = drizzleUnitOfWork(database.db, { ledger, services, logger });
    await uow.run(async (scope) => {
      const slots = (await scope.slots.get(serviceId))!;
      await scope.slots.save(withSlot(slots, { physical: 'green', releaseId, state: 'ready', replicas: 1, readyReplicas: 1, updatedAt: now }, now));
    });
    const green = (await slotRecord(serviceId, 'green'))!;
    await resources.api.observe({ child: { kind: 'Deployment', namespace: 'cs-demo', name: 'demo-green', uid: 'uid-demo-green-2', phase: 'Unready', ready: false, reason: '副本 0／1 就绪', replicas: 1, readyReplicas: 0 } });
    expect((await resources.api.get(green.id))?.phase).toBe('degraded');
    const slots = (await uow.read.slots.get(serviceId))!;
    const [, standby] = await loadSlotDtos(uow.read, slots, 'demo', { prodHost: () => 'demo.cs.localhost', previewHost: () => 'preview.demo.cs.localhost' });
    // 副本数同样照台账：流水线记的是 1／1，Deployment 眼下 0／1。
    expect(standby).toMatchObject({ name: 'preview', state: 'degraded', replicas: 1, readyReplicas: 0 });
    expect((await loadSlotDtos(drizzleUnitOfWork(database.db).read, slots, 'demo', { prodHost: () => 'd', previewHost: () => 'p' }))[1]).toMatchObject({ state: 'ready', readyReplicas: 1 });
  });

  test('待命槽的保留计时随槽的保存进记录：到期时刻按平台策略算，推迟后记录随之变化（页面据此随推送流重读）', async () => {
    const uow = drizzleUnitOfWork(database.db, { ledger, services, logger });
    const retention = { kind: 'rollback-target' as const, since: now, postponements: 0 };
    await uow.run(async (scope) => {
      const slots = (await scope.slots.get(serviceId))!;
      await scope.slots.save(withSlot(slots, { ...slots.green, retention }, now));
    });
    const green = (await slotRecord(serviceId, 'green'))!;
    expect(green.display).toMatchObject({ role: 'preview', retentionDeadline: '2026-09-26T12:00:00.000Z', retentionPeriodHours: '72', retentionPostponements: '0' });
    expect(green.conditions.find((entry) => entry.type === 'RetentionDeadline')).toMatchObject({ status: 'true', reason: 'rollback-target' });
    await uow.run(async (scope) => {
      const slots = (await scope.slots.get(serviceId))!;
      await scope.slots.save(withSlot(slots, { ...slots.green, retention: { ...retention, postponedUntil: new Date('2026-09-29T12:00:00.000Z'), postponements: 1 } }, now));
    });
    const postponed = (await slotRecord(serviceId, 'green'))!;
    expect(postponed.version).toBeGreaterThan(green.version);
    expect(postponed.display).toMatchObject({ retentionDeadline: '2026-09-29T12:00:00.000Z', retentionPostponements: '1' });
  });

  test('构建、迁移 Job 投影进台账：ref 是 <发布>/build|migration，子对象是那个 Job，展示字段是发布与版本；台账写失败只记告警', async () => {
    const uow = drizzleUnitOfWork(database.db, { ledger, services, logger });
    await uow.run(async (scope) => { await scope.ledger?.job({ kind: 'build-job', releaseId, tag: 'v0.1.0', projectId, namespace: 'cs-demo', jobName: 'build-01a0bf5d' }); });
    await uow.run(async (scope) => { await scope.ledger?.job({ kind: 'migration-job', releaseId, tag: 'v0.1.0', projectId, namespace: 'cs-demo', jobName: 'migrate-01a0bf5d' }); });
    const jobs = (await resources.api.list({ projectId, includeStopped: true })).filter((record) => record.kind === 'build-job' || record.kind === 'migration-job');
    expect(jobs.map((record) => [record.kind, record.owner.ref, record.phase, record.children[0]?.name, record.display['tag']]).sort()).toEqual([
      ['build-job', `${releaseId}/build`, 'provisioning', 'build-01a0bf5d', 'v0.1.0'], ['migration-job', `${releaseId}/migration`, 'provisioning', 'migrate-01a0bf5d', 'v0.1.0'],
    ]);
    const broken = drizzleUnitOfWork(database.db, { ledger: { within: () => ({ declare: async () => { throw new Error('台账暂时不可用'); }, find: async () => undefined, report: async () => undefined }) }, services, logger });
    await broken.run(async (scope) => { await scope.ledger?.job({ kind: 'build-job', releaseId, tag: 'v0.1.1', projectId, namespace: 'cs-demo', jobName: 'build-x' }); });
    expect(warnings).toContain('resource ledger job projection failed');
  });

  test('补投影工作器：启动即跑一次、此后按周期；失败只记告警；停止时等本轮跑完', async () => {
    let calls = 0;
    const seen: string[] = [];
    const quiet: Logger = { ...logger, info: (msg) => { seen.push(msg); }, warn: (msg) => { seen.push(msg); } };
    const worker = slotLedgerResyncWorker(async () => { calls += 1; if (calls === 2) throw new Error('台账暂时不可用'); return 2; }, quiet, 30);
    worker.start(); worker.start();
    const deadline = Date.now() + 2_000;
    while (calls < 3 && Date.now() < deadline) await Bun.sleep(10);
    await worker.stop();
    expect(seen).toContain('resource ledger slots resynced'); expect(seen).toContain('resource ledger slot resync failed');
  });
});
