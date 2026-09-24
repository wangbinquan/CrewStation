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
  const serviceId = '01a0bf5d-8f4b-7455-8963-87369647717e' as ServiceId, projectId = '01a0bf5d-8f4b-7aef-84b8-c458233bab22' as ProjectId;
  const actor: Actor = { userId: '01a0bf5d-8f4b-7ed2-8386-a4b2e1a36efb' as UserId, isAdmin: false }, tags: string[] = [], queued: string[] = [];
  let bothTagged!: () => void; const tagsReady = new Promise<void>((resolve) => { bothTagged = resolve; });
  try {
    const publish = publishUseCase({
      uow, clock: fixedClock('2026-09-13T01:00:00.000Z'), authorizer: { authorize: async () => {} },
      services: { resolveServiceById: async () => ({ projectId, slug: 'demo', name: 'demo', namespace: 'cs-demo' }) },
      tagger: { createReleaseTag: async (_id, input) => { tags.push(input.version!); if (tags.length === 2) bothTagged(); await tagsReady; return { tag: input.version!, commitSha: 'a'.repeat(40) }; } },
      jobs: { enqueuePipelineStep: async (id) => { queued.push(id); } },
      // 统一预检读得到一份合法的 Manifest、套餐与生产配置（RFC-025 设计 §5）。
      repo: { readFile: async () => 'apiVersion: crewstation/v2\nkind: DigitalWorker\nspec:\n  service: { command: [bun], port: 3000, healthPath: /healthz, servicePlanId: 01a0bf5d-8f4b-781d-8b8e-bbbbc69c6c6a, replicas: 1 }\n', repositoryUrl: async () => ({ httpUrl: 'https://repo.invalid/demo', credentialSecretName: 'demo-git' }) },
      plans: { getServicePlan: async () => ({ id: '01a0bf5d-8f4b-781d-8b8e-bbbbc69c6c6a', name: 'small', cpu: '1', memory: '1Gi', maxReplicas: 3, description: '' }), lookupComputeProfile: async () => undefined, listComputeProfiles: async () => [] },
      maintenance: { open: async () => false },
      config: { render: async () => ({ values: {}, version: 1 }), validate: async () => ({ missing: [] }) }, data: { envFor: async () => ({}) },
      settings: { registryBase: 'registry', buildTimeoutSeconds: 10, deployTimeoutSeconds: 600, serviceDomain: 'svc.internal', userDomain: 'cs.localhost', builderImage: 'builder', buildkitAddress: 'buildkit' },
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
