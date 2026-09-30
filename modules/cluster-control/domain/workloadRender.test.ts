import { describe, expect, test } from 'bun:test';
import { volumeRenderOf, workloadRenderOf, workspaceUnchanged } from './workloadRender';

const pod = { image: 'task:1', workerUid: 10001, resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, workload: 'dev-session', project: 'demo', service: 'demo', pvc: 'task-1-work', secret: 'task-1-runner-1' };
const children = [{ kind: 'Pod', namespace: 'cs-demo', name: 'task-1' }, { kind: 'Secret', namespace: 'cs-demo', name: 'task-1-runner-1' }, { kind: 'Service', namespace: 'cs-demo', name: 'task-1' }];

// RFC-025 I25：工作区记录里的期望（task-runtime 写，不含凭据）→ 调和器建出容器的渲染输入。
describe('工作区记录 → 渲染输入', () => {
  test('可靠业务卷布局保留；未知版本、错误 owner、临时卷与源码检出拒绝', () => {
    const id = '01a0bf5d-8f4b-7001-8458-107366e7de39';
    const businessStorage = { version: 1, ownerTaskId: id, initialize: true };
    const valid = { ...pod, workload: 'business-task', businessStorage };
    expect(workloadRenderOf(id, { children, pod: valid })?.pod.businessStorage).toMatchObject(businessStorage);
    for (const broken of [
      { ...valid, businessStorage: { ...businessStorage, version: 2 } },
      { ...valid, businessStorage: { ...businessStorage, ownerTaskId: '01a0bf5d-8f4b-7001-8458-107366e7de40' } },
      { ...valid, pvc: undefined, emptyDir: true }, { ...valid, workload: 'dev-session' },
      { ...valid, checkout: { repoUrl: 'repo', branch: 'main', credentialSecretName: 'git' } },
    ]) expect(workloadRenderOf(id, { children, pod: broken })).toBeUndefined();
  });
  test('Pod 的对象名取自子对象，任务 ID 是记录 ID；检出与预览照写', () => {
    const checkout = { repoUrl: 'http://git/demo.git', branch: 'main', credentialSecretName: 'git-cred' };
    const route = { host: 'dev.demo.cs.localhost', middlewares: [{ name: 'auth', namespace: 'sys' }, { name: 'plain' }] };
    expect(workloadRenderOf('rec-1', { children, pod: { ...pod, checkout }, preview: { port: 3000, kind: 'dev-session', route } })).toEqual({
      pod: { name: 'task-1', namespace: 'cs-demo', taskId: 'rec-1', ...pod, checkout },
      preview: { name: 'task-1', namespace: 'cs-demo', taskId: 'rec-1', kind: 'dev-session', targetPort: 3000, route },
    });
    expect(workloadRenderOf('rec-1', { children, pod, preview: { port: 3000, kind: 'business' } })?.preview).toEqual({ name: 'task-1', namespace: 'cs-demo', taskId: 'rec-1', kind: 'business', targetPort: 3000 });
    expect(workloadRenderOf('rec-1', { children, pod })).toEqual({ pod: { name: 'task-1', namespace: 'cs-demo', taskId: 'rec-1', ...pod } });
    // I25：凭据 Secret 由资源中心按这一次启动建的，照写 ownedCredential；为假与没写一样。
    expect(workloadRenderOf('rec-1', { children, pod: { ...pod, checkout: { ...checkout, ownedCredential: true } } })?.pod.checkout).toEqual({ ...checkout, ownedCredential: true });
    expect(workloadRenderOf('rec-1', { children, pod: { ...pod, checkout: { ...checkout, ownedCredential: false } } })?.pod.checkout).toEqual(checkout);
  });

  test('记录是数据：没有 pod（旧形状）、字段不全或类型不对、子对象缺命名空间、预览不完整，都不渲染', () => {
    for (const broken of [
      {}, { pod: { ...pod, image: '' } }, { pod: { ...pod, workerUid: '10001' } }, { pod: { ...pod, project: 7 } }, { pod: { ...pod, resources: { cpu: '1' } } },
      { pod: { ...pod, checkout: { repoUrl: 'x' } } }, { pod: { ...pod, checkout: { repoUrl: 'x', branch: 'main', credentialSecretName: 'c', ownedCredential: 'yes' } } }, { pod, preview: { kind: 'dev-session' } }, { pod, preview: { port: 3000, kind: 'dev-session', route: { host: 'h', middlewares: [{ namespace: 'x' }] } } },
      { pod, preview: { port: 3000, kind: 'dev-session', route: { middlewares: [] } } },
    ]) expect(workloadRenderOf('rec-1', { children, ...broken })).toBeUndefined();
    expect(workloadRenderOf('rec-1', { children: [{ kind: 'Pod', name: 'task-1' }], pod })).toBeUndefined();
    // 工作目录：自己的 PVC 或 Pod 内的临时目录（档位测试，I25 第四步），正好一个。
    const { pvc: _pvc, ...scratch } = pod;
    expect(workloadRenderOf('rec-1', { children, pod: { ...scratch, emptyDir: true } })?.pod).toEqual({ name: 'task-1', namespace: 'cs-demo', taskId: 'rec-1', ...scratch, emptyDir: true });
    expect(workloadRenderOf('rec-1', { children, pod: { ...pod, emptyDir: true } })).toBeUndefined();
    expect(workloadRenderOf('rec-1', { children, pod: scratch })).toBeUndefined();
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
    // 执行环境挂父工作区的卷：没有 PVC 的不渲染。
    const { pvc: _pvc, ...scratch } = pod;
    expect(workloadRenderOf('exe-1', { children, pod: { ...scratch, emptyDir: true, ...extras } })).toBeUndefined();
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

// RFC-034: selected numeric layout survives ledger parsing; omission remains an ordinary workspace.
test('numeric layout parsing keeps both private stores only for an explicit independent development workload', () => {
  const selected = { ...pod, nodeName: 'original-node', workspace: { pod: 'original-parent', podUid: 'original-pod', pvcUid: 'original-pvc' }, developmentUsageStorage: { version: 1 } };
  expect(workloadRenderOf('record', { children, pod: selected })?.pod.developmentUsageStorage).toEqual({ version: 1 });
  expect(workloadRenderOf('record', { children, pod })?.pod.developmentUsageStorage).toBeUndefined();
  for (const patch of [
    { developmentUsageStorage: { version: 2 } }, { developmentUsageStorage: { version: 1, directory: '/work' } }, { developmentUsageStorage: null },
    { workload: 'business-task' }, { workload: 'profile-test' }, { workspace: undefined }, { nodeName: undefined }, { pvc: undefined, emptyDir: true },
    { checkout: { repoUrl: 'https://fixture.invalid/repo', branch: 'main', credentialSecretName: 'checkout' } }, { businessStorage: { version: 1, ownerTaskId: 'owner' } }, { archive: { ownerTaskId: 'owner' } }, { consumer: {} },
  ]) expect(workloadRenderOf('record', { children, pod: { ...selected, ...patch } })).toBeUndefined();
});
