import { describe, expect, test } from 'bun:test';
import { classifyObject, countVerdicts } from './adoption';
import type { ObservedObject } from './observation';
import { goneChild, podChild, podConditions, presentChild, pvcChild } from './observation';

const at = '2026-09-23T12:00:00.000Z';
const pod = (status: unknown, patch: Partial<ObservedObject['metadata']> = {}, spec: unknown = { nodeName: 'desktop-worker' }): ObservedObject => ({
  kind: 'Pod', metadata: { name: 'task-1', namespace: 'cs-demo', uid: 'uid-1', ...patch }, spec, status,
});

describe('Pod 与 PVC 的观测映射（RFC-025 设计 §6.2）', () => {
  test('运行且 Ready 为真才算就绪；节点与重启次数带上', () => {
    const running = podChild(pod({ phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [{ ready: true, restartCount: 2 }] }), at);
    expect(running).toEqual({ kind: 'Pod', namespace: 'cs-demo', name: 'task-1', uid: 'uid-1', phase: 'Running', ready: true, node: 'desktop-worker', restarts: 2, observedAt: at });
    expect(podChild(pod({ phase: 'Running', conditions: [{ type: 'Ready', status: 'False' }] }), at).ready).toBe(false);
  });

  test('还没好的原因：调度失败、等镜像、失败退出；删除中一律不算就绪', () => {
    expect(podChild(pod({ phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False', message: '0/1 nodes are available: Insufficient cpu' }] }, {}, {}), at))
      .toMatchObject({ phase: 'Pending', ready: false, reason: '0/1 nodes are available: Insufficient cpu' });
    expect(podChild(pod({ phase: 'Pending', containerStatuses: [{ state: { waiting: { reason: 'ImagePullBackOff', message: 'Back-off pulling image' } } }] }), at).reason).toBe('ImagePullBackOff: Back-off pulling image');
    expect(podChild(pod({ phase: 'Pending', initContainerStatuses: [{ state: { waiting: { reason: 'PodInitializing' } } }] }), at).reason).toBeUndefined();
    expect(podChild(pod({ phase: 'Failed', containerStatuses: [{ state: { terminated: { reason: 'OOMKilled', exitCode: 137 } } }] }), at).reason).toBe('OOMKilled');
    expect(podChild(pod({ phase: 'Failed', reason: 'Evicted', message: 'low on ephemeral-storage' }), at).reason).toBe('Evicted: low on ephemeral-storage');
    expect(podChild(pod({ phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] }, { deletionTimestamp: at }), at)).toMatchObject({ ready: false, reason: 'Terminating' });
    expect(podChild(pod(undefined), at).phase).toBe('Pending');
    expect(podChild(pod({ phase: 'Pending', message: 'x'.repeat(900), reason: 'Long' }), at).reason?.length).toBe(500);
  });

  test('崩溃重启循环报条件 CrashLooping；恢复后报为假', () => {
    expect(podConditions(pod({ containerStatuses: [{ state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off 5m0s' } } }] }))).toEqual([{ type: 'CrashLooping', status: 'true', reason: 'CrashLoopBackOff', message: 'back-off 5m0s' }]);
    expect(podConditions(pod({ phase: 'Running' }))).toEqual([{ type: 'CrashLooping', status: 'false' }]);
  });

  test('Runner Secret、预览 Service 与路由：在即就绪，删除中记 Terminating', () => {
    const route: ObservedObject = { kind: 'IngressRoute', metadata: { name: 'task-1', namespace: 'cs-demo', uid: 'u-route' } };
    expect(presentChild(route, '2026-09-23T12:00:00.000Z')).toEqual({ kind: 'IngressRoute', namespace: 'cs-demo', name: 'task-1', uid: 'u-route', phase: 'Present', ready: true, observedAt: '2026-09-23T12:00:00.000Z' });
    expect(presentChild({ ...route, metadata: { ...route.metadata, deletionTimestamp: '2026-09-23T12:00:00Z' } }, '2026-09-23T12:00:01.000Z')).toMatchObject({ phase: 'Terminating', ready: false });
  });

  test('PVC：Bound 即就绪，删除中不算；消失的对象只留身份', () => {
    const pvc: ObservedObject = { kind: 'PersistentVolumeClaim', metadata: { name: 'task-1-work', namespace: 'cs-demo', uid: 'uid-pvc' }, status: { phase: 'Bound' } };
    expect(pvcChild(pvc, at)).toEqual({ kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'task-1-work', uid: 'uid-pvc', phase: 'Bound', ready: true, observedAt: at });
    expect(pvcChild({ ...pvc, metadata: { ...pvc.metadata, deletionTimestamp: at } }, at)).toMatchObject({ ready: false, reason: 'Terminating' });
    expect(pvcChild({ ...pvc, status: undefined }, at).phase).toBe('Pending');
    expect(goneChild(pvc)).toEqual({ kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'task-1-work', uid: 'uid-pvc', phase: 'absent', ready: false });
  });
});

describe('收编空跑的判定（设计 §6.5）', () => {
  const labeled = (labels: Record<string, string>, kind = 'Pod'): ObservedObject => ({ kind, metadata: { name: 'obj', namespace: 'cs-demo', uid: 'u', labels } });

  test('已认领、带资源标签却没人认领、认不出归属', () => {
    expect(classifyObject({ object: labeled({}), claimedBy: 'r1' })).toMatchObject({ verdict: 'owned', resourceId: 'r1' });
    expect(classifyObject({ object: labeled({ 'crewstation.io/resource-id': 'r9' }) })).toMatchObject({ verdict: 'orphan', resourceId: 'r9' });
    expect(classifyObject({ object: labeled({}) })).toMatchObject({ verdict: 'unclassified', reason: '没有可识别的归属标签' });
  });

  test('按任务标签：还在的可收编（候选种类按用途）；失败的开发会话保留；已释放、已失败、查不到的是孤儿；工作卷只进待回收', () => {
    const task = { 'crewstation.io/task': 't1' };
    expect(classifyObject({ object: labeled(task), legacyTask: { kind: 'dev-session', state: 'running', execution: false } })).toMatchObject({ verdict: 'adoptable', candidateKind: 'dev-workspace', owner: 'task-runtime', ownerRef: 't1' });
    expect(classifyObject({ object: labeled(task), legacyTask: { kind: 'dev-session', state: 'creating', execution: true } }).candidateKind).toBe('agent-execution');
    expect(classifyObject({ object: labeled(task), legacyTask: { kind: 'business', state: 'paused', execution: false } }).candidateKind).toBe('business-workspace');
    expect(classifyObject({ object: labeled(task), legacyTask: { kind: 'profile-test', state: 'running', execution: false } }).candidateKind).toBe('agent-execution');
    expect(classifyObject({ object: labeled(task, 'PersistentVolumeClaim'), legacyTask: { kind: 'dev-session', state: 'running', execution: false } }).candidateKind).toBe('volume');
    expect(classifyObject({ object: labeled(task), legacyTask: { kind: 'dev-session', state: 'failed', execution: false } }).verdict).toBe('retained');
    const now = new Date('2026-09-23T12:00:00Z');
    expect(classifyObject({ object: labeled(task), now, legacyTask: { kind: 'dev-session', state: 'failed', execution: false, lastActivityAt: '2026-09-22T12:00:00Z' } }).verdict).toBe('retained');
    expect(classifyObject({ object: labeled(task), now, legacyTask: { kind: 'dev-session', state: 'failed', execution: false, lastActivityAt: '2026-09-19T12:00:00Z' } }))
      .toMatchObject({ verdict: 'orphan', reason: '失败的开发会话已过 72 小时保留期（按最后活动时间算），对象仍在' });
    expect(classifyObject({ object: labeled(task), legacyTask: { kind: 'dev-session', state: 'failed', execution: true } })).toMatchObject({ verdict: 'orphan', reason: '任务环境 t1 已失败，对象仍在' });
    expect(classifyObject({ object: labeled(task), legacyTask: { kind: 'business', state: 'released', execution: false } }).reason).toBe('任务环境 t1 已释放，对象仍在');
    expect(classifyObject({ object: labeled(task, 'PersistentVolumeClaim'), legacyTask: 'missing' }).reason).toBe('任务环境 t1 的记录已不存在；工作卷只进入待回收，由管理员确认后删除');
  });

  test('系统命名空间里的平台组件单列，不在收编与回收范围；档位测试的 Pod 带任务标签，按任务判定', () => {
    const platform = { ...labeled({}), metadata: { name: 'cs-api-1', namespace: 'crewstation-system', labels: { 'app.kubernetes.io/managed-by': 'crewstation' } } };
    expect(classifyObject({ object: platform, systemNamespace: 'crewstation-system' })).toMatchObject({ verdict: 'platform', reason: '平台组件（安装器管理），不在收编与回收范围' });
    expect(classifyObject({ object: platform, systemNamespace: 'crewstation-system', claimedBy: 'r1' }).verdict).toBe('owned');
    const profileTest = { ...labeled({}), metadata: { name: 'task-t9', namespace: 'crewstation-system', labels: { 'crewstation.io/task': 't9' } } };
    expect(classifyObject({ object: profileTest, systemNamespace: 'crewstation-system', legacyTask: { kind: 'profile-test', state: 'running', execution: false } })).toMatchObject({ verdict: 'adoptable', candidateKind: 'agent-execution' });
  });

  test('服务槽、构建与迁移的 Pod 留给第三期；计数覆盖六种结论', () => {
    expect(classifyObject({ object: labeled({ 'crewstation.io/workload': 'service', 'crewstation.io/release': 'rel-1' }) })).toMatchObject({ verdict: 'adoptable', candidateKind: 'service-slot', owner: 'release', ownerRef: 'rel-1' });
    expect(classifyObject({ object: labeled({ 'crewstation.io/workload': 'service' }) }).ownerRef).toBeUndefined();
    expect(classifyObject({ object: labeled({ 'app.kubernetes.io/component': 'build' }) }).candidateKind).toBe('build-job');
    expect(classifyObject({ object: labeled({ 'app.kubernetes.io/component': 'migration' }) }).candidateKind).toBe('migration-job');
    const items = [classifyObject({ object: labeled({}), claimedBy: 'r' }), classifyObject({ object: labeled({}) }), classifyObject({ object: labeled({}) })];
    expect(countVerdicts(items)).toEqual({ owned: 1, adoptable: 0, orphan: 0, retained: 0, platform: 0, unclassified: 2 });
  });
});
