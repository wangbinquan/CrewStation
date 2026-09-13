import { expect, test } from 'bun:test';
import type { Actor, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { fixedClock } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleUnitOfWork } from '../adapters/persistence/drizzleUnitOfWork';
import { publishUseCase } from '../application/publish';
import { releaseMigrations } from '../wiring';

const available = await testDatabaseAvailable();
test.skipIf(!available)('两个发布在打标时并行，首次部署也只登记一条流水线；冲突如实返回已创建标签', async () => {
  const db = await createTestDatabase([eventbusMigrations, releaseMigrations]), uow = drizzleUnitOfWork(db.db);
  const serviceId = `svc_${'a'.repeat(32)}` as ServiceId, projectId = `prj_${'b'.repeat(32)}` as ProjectId;
  const actor: Actor = { userId: `usr_${'c'.repeat(32)}` as UserId, isAdmin: false }, tags: string[] = [], queued: string[] = [];
  let bothTagged!: () => void; const tagsReady = new Promise<void>((resolve) => { bothTagged = resolve; });
  try {
    const publish = publishUseCase({
      uow, clock: fixedClock('2026-09-13T01:00:00.000Z'), authorizer: { authorize: async () => {} },
      services: { resolveServiceById: async () => ({ projectId, slug: 'demo', name: 'demo', namespace: 'cs-demo' }) },
      tagger: { createReleaseTag: async (_id, input) => { tags.push(input.version!); if (tags.length === 2) bothTagged(); await tagsReady; return { tag: input.version!, commitSha: 'a'.repeat(40) }; } },
      jobs: { enqueuePipelineStep: async (id) => { queued.push(id); } },
    });
    const results = await Promise.allSettled(['v1.0.0', 'v1.1.0'].map((version) => publish(actor, serviceId, { branch: 'main', version })));
    expect(tags).toHaveLength(2); expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const stored = await uow.read.releases.listByService(serviceId, 10); expect(stored).toHaveLength(1); expect(stored[0]?.status).toBe('pending');
    const unusedTag = tags.find((tag) => tag !== stored[0]?.tag);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { kind: 'conflict', message: expect.stringContaining('已创建标签'), details: { releaseId: stored[0]!.id, createdTag: unusedTag } } });
    expect(queued).toEqual([stored[0]!.id]);
    const events = await db.handle.client`SELECT topic FROM platform_infra.domain_events WHERE topic = 'release.status-changed'`;
    expect(events).toHaveLength(1);
  } finally { await db.drop(); }
});
