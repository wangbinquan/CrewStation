import { describe, expect, test } from 'bun:test';
import { volumeRenderOf, workloadRenderOf, workspaceUnchanged } from './workloadRender';

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

// I25 第二步：执行环境的附加期望——节点、父工作区、附加标签与注解。
describe('执行环境记录 → 渲染输入', () => {
  const extras = { nodeName: 'node-a', workspace: { pod: 'task-p', podUid: 'u-parent', pvcUid: 'u-pvc' }, labels: { 'crewstation.io/workspace-task': 'p' }, annotations: { 'crewstation.io/cli-intent': 'digest' } };

  test('节点、父工作区与附加标签注解照写；没有的不出现', () => {
    expect(workloadRenderOf('exe-1', { children, pod: { ...pod, ...extras } })?.pod).toEqual({ name: 'task-1', namespace: 'cs-demo', taskId: 'exe-1', ...pod, ...extras });
    expect(workloadRenderOf('exe-1', { children, pod: { ...pod, labels: {}, annotations: {} } })?.pod).toEqual({ name: 'task-1', namespace: 'cs-demo', taskId: 'exe-1', ...pod });
  });

  test('附加标签不能改平台自己的标签；有父工作区却没有节点、类型不对，都不渲染', () => {
    for (const broken of [
      { labels: { 'crewstation.io/task': 'other' } }, { labels: { 'crewstation.io/workload': 'x' } }, { labels: { a: 1 } }, { annotations: 'x' }, { nodeName: '' },
      { workspace: extras.workspace }, { nodeName: 'node-a', workspace: { pod: 'task-p', podUid: 'u-parent' } },
    ]) expect(workloadRenderOf('exe-1', { children, pod: { ...pod, ...broken } })).toBeUndefined();
  });

  test('父工作区核对：没有要核对的一律没变；缓存里缺一样，或实例、节点、运行、绑定、删除中任一不对，都算变了', () => {
    const render = workloadRenderOf('exe-1', { children, pod: { ...pod, ...extras } })!.pod;
    const parent = { metadata: { uid: 'u-parent' }, spec: { nodeName: 'node-a' }, status: { phase: 'Running' } }, volume = { metadata: { uid: 'u-pvc' }, status: { phase: 'Bound' } };
    expect(workspaceUnchanged(workloadRenderOf('rec-1', { children, pod })!.pod, undefined, undefined)).toBe(true);
    expect(workspaceUnchanged(render, parent, volume)).toBe(true);
    expect(workspaceUnchanged(render, undefined, volume)).toBe(false);
    expect(workspaceUnchanged(render, parent, undefined)).toBe(false);
    for (const [p, v] of [
      [{ ...parent, metadata: { uid: 'u-x' } }, volume], [{ ...parent, spec: { nodeName: 'node-b' } }, volume], [{ ...parent, status: { phase: 'Pending' } }, volume],
      [{ ...parent, metadata: { uid: 'u-parent', deletionTimestamp: 'now' } }, volume], [parent, { ...volume, metadata: { uid: 'u-y' } }], [parent, { ...volume, status: { phase: 'Pending' } }],
      [parent, { ...volume, metadata: { uid: 'u-pvc', deletionTimestamp: 'now' } }],
    ] as const) expect(workspaceUnchanged(render, p, v)).toBe(false);
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
