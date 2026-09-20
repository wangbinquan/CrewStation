import { expect, test } from 'bun:test';
import type { Actor, ProjectId, ReleaseId, ServiceId, UserId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { releaseQueries } from '../application/queries';
import { initialSlots } from '../domain/slots';
import { releaseMigrations } from '../wiring';

const available = await testDatabaseAvailable();
const serviceId = '01a0bf5d-8f4b-7455-8963-87369647717e' as ServiceId, projectId = '01a0bf5d-8f4b-7aef-84b8-c458233bab22' as ProjectId;
const tester: Actor = { userId: '01a0bf5d-8f4b-7ed2-8386-a4b2e1a36efb' as UserId, isAdmin: false };

test.skipIf(!available)('预览查询使用测试者既有权限，仅返回当前待命槽；切流、未部署和撤权按实际记录变化', async () => {
  const db = await createTestDatabase([eventbusMigrations, releaseMigrations]), uow = drizzleUnitOfWork(db.db), now = new Date();
  const prodId = '01a0bf5d-8f4b-762d-81e1-f95f4dd57c2d' as ReleaseId, previewId = '01a0bf5d-8f4b-7dda-8ca7-d5d5f8a92b44' as ReleaseId;
  let permitted = true;
  const api = releaseQueries({ uow, authorizer: { authorize: async (actor, project, action) => {
    expect(actor).toEqual(tester); expect(project).toBe(projectId);
    if (!permitted || action !== 'view-preview') throw new Error('forbidden');
  } }, services: { resolveServiceById: async () => ({ projectId, slug: 'demo', name: 'demo', namespace: 'cs-demo' }) },
  hosts: { prodHost: () => 'formal.demo.test', previewHost: () => 'preview.demo.test' } });
  try {
    expect(await api.getPreviewSlot(tester, serviceId)).toBeNull();
    const base = { serviceId, projectId, branch: 'main', status: 'ready' as const, pipeline: { step: 4 }, createdBy: tester.userId, createdAt: now, updatedAt: now };
    await uow.run(async (scope) => {
      await scope.releases.insert({ ...base, id: prodId, tag: 'v1.0.0', commitSha: 'd'.repeat(40), targetSlot: 'blue', image: 'internal/image', configVersion: 7, message: 'private release note' });
      await scope.releases.insert({ ...base, id: previewId, tag: 'v1.0.1', commitSha: 'e'.repeat(40), targetSlot: 'green' });
      const slots = initialSlots(serviceId, now);
      await scope.slots.save({ ...slots, blue: { ...slots.blue, releaseId: prodId, state: 'ready', replicas: 1, readyReplicas: 1 },
        green: { ...slots.green, releaseId: previewId, state: 'deploying', replicas: 1, readyReplicas: 0 } });
    });
    await expect(api.getSlots(tester, serviceId)).rejects.toThrow('forbidden');
    const deploying = await api.getPreviewSlot(tester, serviceId);
    expect(deploying).toMatchObject({ name: 'preview', active: false, releaseId: previewId, state: 'deploying', readyReplicas: 0 });
    expect(JSON.stringify(deploying)).not.toContain('formal.demo.test'); expect(JSON.stringify(deploying)).not.toContain('image');
    await uow.run(async (scope) => {
      const slots = (await scope.slots.get(serviceId))!;
      await scope.slots.save({ ...slots, active: 'green', green: { ...slots.green, state: 'ready', readyReplicas: 1 } });
    });
    const standby = await api.getPreviewSlot(tester, serviceId);
    expect(standby).toMatchObject({ name: 'preview', active: false, releaseId: prodId, tag: 'v1.0.0', commitSha: 'd'.repeat(40), host: 'preview.demo.test' });
    expect(standby).not.toHaveProperty('image'); expect(standby).not.toHaveProperty('configVersion'); expect(standby).not.toHaveProperty('message');
    permitted = false; await expect(api.getPreviewSlot(tester, serviceId)).rejects.toThrow('forbidden');
  } finally { await db.drop(); }
});
