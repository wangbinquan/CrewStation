import { expect, test } from 'bun:test';
import type { DevelopmentSourceBinding, ProjectId, ReleaseId, ServiceId, TaskId, WorkloadIdentity } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { objectStorageSources } from '../application/objectStorageSources';

test('开发与生产来源固定不同空间，释放或换 Pod 后开发令牌不能继承生产身份', async () => {
  const service = { projectId: newResourceId() as ProjectId, serviceId: newResourceId() as ServiceId, state: 'active' };
  const binding: DevelopmentSourceBinding = { podUid: 'dev-uid', podName: 'dev-current', ip: '10.1.2.3', taskId: newResourceId() as TaskId, ready: true };
  const dev = { identity: 'demo/demo', project: 'demo', service: 'demo', kind: 'dev-session' as const, developmentSource: binding };
  const prod = { ...dev, kind: 'service' as const, source: { podUid: 'prod-uid', ip: '10.1.2.4', releaseId: newResourceId() as ReleaseId, physicalSlot: 'blue' as const, ready: true } };
  let current: (WorkloadIdentity & { developmentSource: DevelopmentSourceBinding }) | undefined = dev;
  let contract: { projectId: ProjectId; serviceId: ServiceId; planId: string } | undefined = { ...service, planId: newResourceId() };
  const sources = objectStorageSources({ resolveServiceSource: async (token) => token === 'prod' ? prod : undefined, resolveDevelopmentSource: async (token) => token === 'dev' ? current : undefined },
    { resolveServiceIdentity: async (name) => name === 'demo/demo' ? service : undefined }, () => ({ objectStorageContract: async () => ({ planId: newResourceId(), fenced: true }) }),
    () => ({ resolveDevelopmentObjectSource: async () => contract }));
  expect(await sources.resolve({ identity: dev.identity, token: 'dev' })).toMatchObject({ env: 'development', fenced: false, planId: contract.planId, podUid: binding.podUid });
  expect(await sources.resolve({ identity: dev.identity, token: 'prod' })).toMatchObject({ env: 'production', fenced: true, podUid: 'prod-uid' });
  for (const caller of [{ identity: 'other/other', token: 'dev' }, { identity: dev.identity }, { identity: dev.identity, token: 'forged' }]) expect(await sources.resolve(caller)).toBeUndefined();
  service.state = 'archived';
  expect(await sources.resolve({ identity: dev.identity, token: 'dev' })).toHaveProperty('writeAllowed', false);
  current = { ...dev, developmentSource: { ...binding, ready: false } };
  expect(await sources.resolve({ identity: dev.identity, token: 'dev' })).toBeUndefined();
  current = dev;
  contract = { ...contract, projectId: newResourceId() as ProjectId };
  expect(await sources.resolve({ identity: dev.identity, token: 'dev' })).toBeUndefined();
  contract = undefined;
  expect(await sources.resolve({ identity: dev.identity, token: 'dev' })).toBeUndefined();
  current = undefined;
  expect(await sources.resolve({ identity: dev.identity, token: 'dev' })).toBeUndefined();
});
