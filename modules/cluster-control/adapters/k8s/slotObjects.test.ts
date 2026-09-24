import { expect, test } from 'bun:test';
import type { SlotRender } from '../../domain/slotRender';
import { RESTARTED_AT_ANNOTATION, slotSecretObject, slotWorkloadObjects } from './slotObjects';

const slot: SlotRender = {
  namespace: 'cs-demo', name: 'demo-blue', secret: 'demo-blue-env-2', serviceId: 'svc-1', project: 'demo', service: 'demo', physical: 'blue', releaseId: 'rel-1', revision: 2,
  image: 'registry.local:5000/demo:v1', command: ['bun', 'run', 'main.ts'], port: 3000, healthPath: '/healthz', replicas: 2, resources: { cpu: '250m', memory: '256Mi' },
};
type Template = { metadata: { annotations?: Record<string, string> }; spec: { containers: Array<{ env: unknown[]; envFrom: unknown }> } };
const templateOf = (object: unknown) => ((object as { spec: { template: Template } }).spec.template);

test('Deployment 带渲染它的期望版本、环境只从这一次的 Secret 引用；有重启标记时写在 Pod 模板上', () => {
  const [deployment, service] = slotWorkloadObjects(slot, 9);
  expect(deployment.metadata).toMatchObject({ name: 'demo-blue', namespace: 'cs-demo', annotations: { 'crewstation.io/resource-generation': '9' } });
  expect(templateOf(deployment).spec.containers[0]).toMatchObject({ env: [], envFrom: [{ secretRef: { name: 'demo-blue-env-2' } }] });
  expect(templateOf(deployment).metadata.annotations).toBeUndefined();
  expect(service.metadata.name).toBe('demo-blue');
  const [restarted] = slotWorkloadObjects({ ...slot, restartedAt: '2026-09-24T08:00:00.000Z' }, 10);
  expect(templateOf(restarted).metadata.annotations).toEqual({ [RESTARTED_AT_ANNOTATION]: '2026-09-24T08:00:00.000Z' });
});

test('环境 Secret：名字是期望里的、不可变、内容照给', () => {
  expect(slotSecretObject(slot, { A: '1' })).toMatchObject({ kind: 'Secret', immutable: true, stringData: { A: '1' }, metadata: { name: 'demo-blue-env-2', namespace: 'cs-demo' } });
});
