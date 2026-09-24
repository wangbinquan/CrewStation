import { expect, test } from 'bun:test';
import { slotRenderOf } from './slotRender';

const children = [{ kind: 'Deployment', namespace: 'cs-demo', name: 'demo-blue' }, { kind: 'Service', namespace: 'cs-demo', name: 'demo-blue' }, { kind: 'Secret', namespace: 'cs-demo', name: 'demo-blue-env-2' }];
const slot = {
  serviceId: 'svc-1', project: 'demo', service: 'demo', physical: 'blue', releaseId: 'rel-1', revision: 2, image: 'registry.local:5000/demo:v1', command: ['bun', 'run', 'main.ts'],
  port: 3000, healthPath: '/healthz', replicas: 2, resources: { cpu: '250m', memory: '256Mi' }, envSecret: 'demo-blue-env-2',
};

test('槽记录的期望：名字取自子对象，字段齐全才渲染；运维重启的标记可选', () => {
  const { envSecret: _envSecret, ...fields } = slot;
  expect(slotRenderOf({ children, slot })).toEqual({ ...fields, namespace: 'cs-demo', name: 'demo-blue', secret: 'demo-blue-env-2', physical: 'blue' } as never);
  expect(slotRenderOf({ children, slot: { ...slot, restartedAt: '2026-09-24T08:00:00.000Z' } })?.restartedAt).toBe('2026-09-24T08:00:00.000Z');
  // 旧形状（release 自己部署）没有 slot：不渲染。
  expect(slotRenderOf({ children: children.slice(0, 2) })).toBeUndefined();
});

test('字段不全、类型不对、子对象对不上槽的名字都不渲染，不猜', () => {
  const broken = [
    { ...slot, image: '' }, { ...slot, physical: 'purple' }, { ...slot, revision: 0 }, { ...slot, port: 70000 }, { ...slot, replicas: -1 }, { ...slot, command: [] },
    { ...slot, command: ['bun', ''] }, { ...slot, resources: { cpu: '1' } }, { ...slot, restartedAt: 7 }, { ...slot, envSecret: 'demo-blue-env-9' },
  ];
  for (const candidate of broken) expect(slotRenderOf({ children, slot: candidate })).toBeUndefined();
  const renamed = [{ ...children[0]!, name: 'other-blue' }, children[1]!, children[2]!];
  expect(slotRenderOf({ children: renamed, slot })).toBeUndefined();
  expect(slotRenderOf({ children: [children[0]!, { ...children[1]!, namespace: 'cs-other' }, children[2]!], slot })).toBeUndefined();
  expect(slotRenderOf({ children: [...children, { kind: 'Secret', namespace: 'cs-demo', name: 'demo-blue-env-1' }], slot })).toBeUndefined();
  expect(slotRenderOf({ children: children.slice(1), slot })).toBeUndefined();
});
