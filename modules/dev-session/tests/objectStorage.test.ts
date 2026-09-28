import { expect, test } from 'bun:test';
import { ManifestSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { sessionLifecycleUseCases } from '../application/sessionLifecycle';
import { workspaceActor, workspaceFixture, workspaceProject, workspaceTask } from './workspaceFixture';

test('对象档位只从所选开发分支固定；未声明和无效 Manifest 保留开启修复会话的路径', async () => {
  const planId = newResourceId(), f = workspaceFixture(), reads: unknown[] = [], creates: unknown[] = [];
  const base = (await f.deps.environments.getEnvironment(workspaceTask))!;
  const service = { servicePlanId: newResourceId(), command: ['app'], port: 3000 };
  let manifest = JSON.stringify({ apiVersion: 'crewstation/v3', kind: 'DigitalWorker', spec: { service, data: { objects: { planId } } } });
  f.state.missing = true;
  f.deps.scm.readFile = async (...args) => { reads.push(args); return manifest; };
  f.deps.manifests.parse = (text) => ManifestSchema.parse(JSON.parse(text));
  f.deps.environments.createEnvironment = async (input) => { creates.push(input); return base; };
  const open = () => sessionLifecycleUseCases(f.deps).openSession(workspaceActor, workspaceProject, { branch: 'feature/objects' });
  await open();
  expect(reads[0]).toEqual([base.serviceId, 'feature/objects', 'crewstation.yaml']);
  expect(creates[0]).toMatchObject({ developmentObjectPlanId: planId, kind: 'dev-session', branch: 'feature/objects' });
  manifest = JSON.stringify({ apiVersion: 'crewstation/v3', kind: 'DigitalWorker', spec: { service } });
  await open();
  expect(creates[1]).not.toHaveProperty('developmentObjectPlanId');
  manifest = 'broken';
  expect((await open()).message).toContain('会话已开启但没有预览');
  expect(creates[2]).not.toHaveProperty('developmentObjectPlanId');
  expect(creates[2]).not.toHaveProperty('preview');
});
