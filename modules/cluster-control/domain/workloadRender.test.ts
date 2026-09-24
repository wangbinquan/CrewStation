import { describe, expect, test } from 'bun:test';
import { volumeRenderOf, workloadRenderOf } from './workloadRender';

const pod = { image: 'task:1', workerUid: 10001, resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, workload: 'dev-session', project: 'demo', service: 'demo', pvc: 'task-1-work', secret: 'task-1-runner-1' };
const children = [{ kind: 'Pod', namespace: 'cs-demo', name: 'task-1' }, { kind: 'Secret', namespace: 'cs-demo', name: 'task-1-runner-1' }, { kind: 'Service', namespace: 'cs-demo', name: 'task-1' }];

// RFC-025 I25：工作区记录里的期望（task-runtime 写，不含凭据）→ 调和器建出容器的渲染输入。
describe('工作区记录 → 渲染输入', () => {
  test('Pod 的对象名取自子对象，任务 ID 是记录 ID；检出与预览照写', () => {
    const checkout = { repoUrl: 'http://git/demo.git', branch: 'main', credentialSecretName: 'git-cred' };
    const route = { host: 'dev.demo.cs.localhost', middlewares: [{ name: 'auth', namespace: 'sys' }, { name: 'plain' }] };
    expect(workloadRenderOf('rec-1', { children, pod: { ...pod, checkout }, preview: { port: 3000, kind: 'dev-session', route } })).toEqual({
      pod: { name: 'task-1', namespace: 'cs-demo', taskId: 'rec-1', ...pod, checkout },
      preview: { name: 'task-1', namespace: 'cs-demo', taskId: 'rec-1', kind: 'dev-session', targetPort: 3000, route },
    });
    expect(workloadRenderOf('rec-1', { children, pod, preview: { port: 3000, kind: 'business' } })?.preview).toEqual({ name: 'task-1', namespace: 'cs-demo', taskId: 'rec-1', kind: 'business', targetPort: 3000 });
    expect(workloadRenderOf('rec-1', { children, pod })).toEqual({ pod: { name: 'task-1', namespace: 'cs-demo', taskId: 'rec-1', ...pod } });
  });

  test('记录是数据：没有 pod（旧形状）、字段不全或类型不对、子对象缺命名空间、预览不完整，都不渲染', () => {
    for (const broken of [
      {}, { pod: { ...pod, image: '' } }, { pod: { ...pod, workerUid: '10001' } }, { pod: { ...pod, project: 7 } }, { pod: { ...pod, resources: { cpu: '1' } } },
      { pod: { ...pod, checkout: { repoUrl: 'x' } } }, { pod, preview: { kind: 'dev-session' } }, { pod, preview: { port: 3000, kind: 'dev-session', route: { host: 'h', middlewares: [{ namespace: 'x' }] } } },
      { pod, preview: { port: 3000, kind: 'dev-session', route: { middlewares: [] } } },
    ]) expect(workloadRenderOf('rec-1', { children, ...broken })).toBeUndefined();
    expect(workloadRenderOf('rec-1', { children: [{ kind: 'Pod', name: 'task-1' }], pod })).toBeUndefined();
    expect(workloadRenderOf('rec-1', { children: [children[0]!], pod, preview: { port: 3000, kind: 'dev-session' } })).toBeUndefined();
  });
});

describe('工作卷记录 → 渲染输入', () => {
  test('PVC 的名字与命名空间取自子对象，大小与标签照写；缺了不渲染', () => {
    const spec = { children: [{ kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'task-1-work' }], pvc: { size: '10Gi', labels: { 'crewstation.io/task': 'rec-1' } } };
    expect(volumeRenderOf(spec)).toEqual({ name: 'task-1-work', namespace: 'cs-demo', size: '10Gi', labels: { 'crewstation.io/task': 'rec-1' } });
    expect(volumeRenderOf({ ...spec, pvc: { size: '10Gi' } })?.labels).toEqual({});
    for (const broken of [{ pvc: undefined }, { pvc: { size: '' } }, { pvc: { size: '10Gi', labels: { a: 1 } } }, { children: [{ kind: 'PersistentVolumeClaim', name: 'x' }] }]) expect(volumeRenderOf({ ...spec, ...broken })).toBeUndefined();
  });
});
