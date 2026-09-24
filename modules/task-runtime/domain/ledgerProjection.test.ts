import { describe, expect, test } from 'bun:test';
import type { ProjectId, ServiceId, TaskId, TraceId } from '@crewstation/contracts';
import { projectEnvironment, runnerCondition } from './ledgerProjection';
import type { NativeExecution, TaskEnvironment } from './taskEnvironment';

const at = new Date('2026-09-23T12:00:00Z');
const env = (patch: Partial<TaskEnvironment> = {}): TaskEnvironment => ({
  id: '01a0bf5d-8f4b-7c01-8e19-e226732a7100' as TaskId, projectId: '01a0bf5d-8f4b-7c01-8e19-e226732a75a4' as ProjectId, serviceId: '01a0bf5d-8f4b-7c01-8e19-e226732a75a5' as ServiceId,
  kind: 'dev-session', state: 'running', volumeMode: 'follow-container', profile: 'coding-medium', namespace: 'cs-demo', podName: 'task-100', pvcName: 'task-100-work',
  traceId: '0123456789abcdef0123456789abcdef' as TraceId, runnerTokenHash: 'h', connected: true, branch: 'main', labels: {}, createdAt: at, updatedAt: at, lastActivityAt: at, ...patch,
});
const native = (patch: Partial<NativeExecution> = {}): NativeExecution => ({
  purpose: 'cli', parentTaskId: '01a0bf5d-8f4b-7c01-8e19-e226732a7100' as TaskId, parentPodUid: 'p', pvcUid: 'v', nodeName: 'n', agentId: 'agent-1', terminalId: 'term-1', runnerId: 'r',
  fingerprint: 'f', requestedProfile: null, profile: { id: 'x', name: 'OpenCode 默认', cpu: '1', memory: '2Gi', storage: '10Gi' }, image: 'img', state: 'running', ...patch,
});

describe('任务环境投影到资源台账（RFC-025 第二期）', () => {
  test('开发会话：开发工作区一条（沿用环境 ID），工作卷一条挂在它下面；领域条件都是「否」', () => {
    const { workload, volume, connected } = projectEnvironment(env());
    expect(workload).toEqual({
      id: env().id, kind: 'dev-workspace', ref: env().id, projectId: env().projectId, purpose: 'development-workspace',
      children: [{ kind: 'Pod', namespace: 'cs-demo', name: 'task-100' }], display: { profile: 'coding-medium', branch: 'main' },
      conditions: [{ type: 'Failed', status: 'false' }, { type: 'Paused', status: 'false' }, { type: 'Rebuilding', status: 'false' }],
    });
    expect(volume).toEqual({ kind: 'volume', ref: `${env().id}/work`, projectId: env().projectId, parentId: env().id, children: [{ kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'task-100-work' }], reclaim: 'delete', display: { mode: 'follow-container' }, conditions: [] });
    expect(connected).toBe(true);
    // 旧身份（RFC-013 之前的 tsk_…）写进台账的别名（设计 §6.5）；工作卷不带。没有旧身份的不写。
    const legacy = projectEnvironment(env({ legacyCluster: { taskId: 'tsk_01a0954107447000b7936485fb80d15d' } }));
    expect(legacy.workload.aliases).toEqual([{ source: 'tsk', alias: 'tsk_01a0954107447000b7936485fb80d15d' }]);
    expect(legacy.volume).not.toHaveProperty('aliases');
    expect(workload).not.toHaveProperty('aliases');
  });

  test('「＋ CLI」：Agent 执行挂在父工作区下，没有自己的工作卷；排队中是「未准备好」，清理中即「不要了」', () => {
    const queued = projectEnvironment(env({ id: '01a0bf5d-8f4b-7c01-8e19-e226732a7101' as TaskId, podName: 'exec-101', native: native({ state: 'queued' }), connected: false }));
    expect(queued.workload).toMatchObject({ kind: 'agent-execution', purpose: 'development-cli', parentId: env().id, display: { profile: 'OpenCode 默认', agent: 'agent-1', terminal: 'term-1' } });
    expect(queued.workload.conditions.at(-1)).toEqual({ type: 'Prepared', status: 'false' });
    expect(queued.volume).toBeUndefined();
    // 说明写结局，不写「正在回收」这类过程：它在已结束的记录上一直显示（2026-09-23 实机）。
    const cleaning = projectEnvironment(env({ native: native({ state: 'cleaning' }), state: 'releasing', message: '此CLI已结束，正在回收执行环境' }));
    expect(cleaning.workload.release).toEqual({ code: 'execution-ended', message: '执行已结束' });
    expect(projectEnvironment(env({ native: native({ state: 'finished', failureReason: 'CLI 进程退出' }) })).workload.release).toEqual({ code: 'execution-ended', message: 'CLI 进程退出' });
    expect(projectEnvironment(env({ native: native({ purpose: 'subtask' }) })).workload.purpose).toBe('business-subtask');
    expect(projectEnvironment(env({ native: native({ purpose: 'agent' }) })).workload.purpose).toBe('development-agent');
  });

  test('失败：条件「失败」带启动失败的归类与原话；暂停；重建中', () => {
    const failed = projectEnvironment(env({ state: 'failed', message: '超过 5 分钟未连接', startup: { state: 'failed', startedAt: at.toISOString(), stages: [{ kind: 'connect', state: 'failed', error: { code: 'connect-timeout', message: 'x' } }] } }));
    // 失败的发生时刻是环境进入 failed 那次落库的时间：保留期从这里算（D9），台账接上之前就失败的会话据此得到真实起点。
    expect(failed.workload.conditions[0]).toEqual({ type: 'Failed', status: 'true', reason: 'connect-timeout', message: '超过 5 分钟未连接', since: at });
    expect(failed.workload.startup?.state).toBe('failed');
    expect(projectEnvironment(env({ state: 'failed' })).workload.conditions[0]).toEqual({ type: 'Failed', status: 'true', reason: 'failed', message: '平台判定失败', since: at });
    expect(projectEnvironment(env({ kind: 'business', state: 'paused' })).workload.conditions[1]).toEqual({ type: 'Paused', status: 'true' });
    expect(projectEnvironment(env({ state: 'creating', rebuildId: 'rb-1' })).workload.conditions[2]).toEqual({ type: 'Rebuilding', status: 'true' });
  });

  test('释放：跟随容器的工作卷随之「不要了」，持久卷留着；档位测试是 Agent 执行、没有工作卷', () => {
    const released = projectEnvironment(env({ state: 'released', release: { reason: 'owner-force', occupied: false } }));
    expect(released.workload.release).toEqual({ code: 'owner-force', message: '负责人强制释放' });
    expect(released.volume?.release).toEqual({ code: 'owner-force', message: '负责人强制释放' });
    // 直接释放：受理时还不知道原因，释放完从 message 里取
    expect(projectEnvironment(env({ state: 'releasing' })).workload.release).toEqual({ code: 'released', message: '已释放' });
    expect(projectEnvironment(env({ state: 'released', message: 'released: user' })).workload.release).toEqual({ code: 'user', message: '用户释放' });
    const persistent = projectEnvironment(env({ kind: 'business', volumeMode: 'persistent', state: 'released' }));
    expect(persistent.workload).toMatchObject({ kind: 'business-workspace', purpose: 'business-workspace', release: { code: 'released', message: '已释放' } });
    expect(persistent.volume?.release).toBeUndefined();
    const test = projectEnvironment(env({ kind: 'profile-test' }));
    expect(test.workload).toMatchObject({ kind: 'agent-execution', purpose: 'profile-test' });
    expect(test.volume).toBeUndefined();
  });

  test('子对象与 task-runtime 建出的名字一一对应：执行环境与重建过的工作区有 Runner Secret；预览路由重建后沿用按环境 ID 算的原名', () => {
    const preview = { command: ['bun', 'dev'], port: 3000, healthPath: '/' };
    expect(projectEnvironment(env({ preview })).workload.children).toEqual([
      { kind: 'Pod', namespace: 'cs-demo', name: 'task-100' }, { kind: 'Service', namespace: 'cs-demo', name: 'task-100' }, { kind: 'IngressRoute', namespace: 'cs-demo', name: 'task-100' },
    ]);
    const route = `task-${env().id.replaceAll('-', '')}`;
    expect(projectEnvironment(env({ preview, rebuildId: 'rb-1', podName: 'task-r-9' })).workload.children).toEqual([
      { kind: 'Pod', namespace: 'cs-demo', name: 'task-r-9' }, { kind: 'Secret', namespace: 'cs-demo', name: 'task-r-9-runner' },
      { kind: 'Service', namespace: 'cs-demo', name: route }, { kind: 'IngressRoute', namespace: 'cs-demo', name: route },
    ]);
    expect(projectEnvironment(env({ podName: 'exec-101', preview, native: native() })).workload.children).toEqual([{ kind: 'Pod', namespace: 'cs-demo', name: 'exec-101' }, { kind: 'Secret', namespace: 'cs-demo', name: 'exec-101-runner' }]);
  });

  test('保留期满由平台回收：工作区不要了，跟随容器的工作卷不随之删除（只进待回收）；持久卷一律留着', () => {
    const expired = projectEnvironment(env({ state: 'released', message: 'released: retention-expired' }));
    expect(expired.workload.release).toEqual({ code: 'retention-expired', message: '失败保留期已满，平台自动回收' });
    expect(expired.volume?.release).toBeUndefined(); expect(expired.volume?.reclaim).toBe('delete');
    expect(projectEnvironment(env({ kind: 'business', volumeMode: 'persistent' })).volume?.reclaim).toBe('retain');
  });

  test('Runner 连接条件：连着报连上；曾经连上、现在没连报断开；从没连上不报', () => {
    expect(runnerCondition(true, [])).toEqual([{ type: 'RunnerConnected', status: 'true' }]);
    expect(runnerCondition(false, [{ type: 'RunnerConnected', status: 'true' }])).toEqual([{ type: 'RunnerConnected', status: 'false', message: 'Runner 已断开' }]);
    expect(runnerCondition(false, [{ type: 'RunnerConnected', status: 'false' }])).toEqual([]);
    expect(runnerCondition(false, [])).toEqual([]);
  });

  // RFC-025 I25：资源中心建出的环境——期望里写渲染要用的（不含凭据），创建中且还没绑定 Pod 时要资源中心建（Provisioning 为真）。
  test('资源中心建出的工作区：子对象带这一次启动的 Runner Secret 与预览；期望写 Pod 与预览；卷写大小与标签；Provisioning 随创建与绑定变化', () => {
    const render = { image: 'task:1', workerUid: 10001, resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, start: 2, checkout: { repoUrl: 'http://git/demo.git', branch: 'main', credentialSecretName: 'git-cred' }, previewRoute: { host: 'dev.demo.cs.localhost', middlewares: [{ name: 'auth', namespace: 'sys' }] } };
    const creating = projectEnvironment(env({ state: 'creating', connected: false, render, preview: { command: ['bun', 'dev'], port: 3000, healthPath: '/' }, labels: { 'crewstation.io/project': 'demo', 'crewstation.io/service': 'demo' } }));
    expect(creating.workload.children).toEqual([{ kind: 'Pod', namespace: 'cs-demo', name: 'task-100' }, { kind: 'Secret', namespace: 'cs-demo', name: 'task-100-runner-2' }, { kind: 'Service', namespace: 'cs-demo', name: 'task-100' }, { kind: 'IngressRoute', namespace: 'cs-demo', name: 'task-100' }]);
    expect(creating.workload.render).toEqual({
      pod: { image: 'task:1', workerUid: 10001, resources: render.resources, workload: 'dev-session', project: 'demo', service: 'demo', pvc: 'task-100-work', secret: 'task-100-runner-2', checkout: render.checkout },
      preview: { port: 3000, kind: 'dev-session', route: render.previewRoute },
    });
    expect(creating.workload.conditions).toContainEqual({ type: 'Provisioning', status: 'true' });
    expect(creating.volume).toMatchObject({ render: { pvc: { size: '10Gi', labels: { 'crewstation.io/task': env().id, 'crewstation.io/project': 'demo' } } }, conditions: [{ type: 'Provisioning', status: 'true' }] });
    // 记下 Pod 实例之后不再要建；运行中同样不要（Pod 丢了不补建）。
    const bound = projectEnvironment(env({ state: 'creating', podUid: 'uid-1', render }));
    expect(bound.workload.conditions).toContainEqual({ type: 'Provisioning', status: 'false' });
    expect(bound.volume?.conditions).toEqual([{ type: 'Provisioning', status: 'false' }]);
    expect(bound.workload.render).toEqual({ pod: expect.objectContaining({ secret: 'task-100-runner-2', project: '', service: '' }) });
    // 重建中的由 task-runtime 自己建：照旧的子对象形状，不写渲染期望。
    const rebuilt = projectEnvironment(env({ state: 'creating', render, rebuildId: 'rb-1', podName: 'task-100-r1' }));
    expect(rebuilt.workload.render).toBeUndefined();
    expect(rebuilt.workload.children.some((child) => child.name.endsWith('-runner-2'))).toBe(false);
    expect(rebuilt.workload.conditions).toContainEqual({ type: 'Provisioning', status: 'false' });
    expect(rebuilt.volume).not.toHaveProperty('render');
  });

  test('资源中心建出的执行环境（I25 第二步）：排队中要建，期望带节点、父工作区、所属工作区标签与意图注解；Secret 沿用 `<Pod 名>-runner`；准备好后不再要建', () => {
    const render = { image: 'img', workerUid: 10001, resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, start: 1, execution: { workspacePod: 'task-100' } };
    const queued = projectEnvironment(env({ id: '01a0bf5d-8f4b-7c01-8e19-e226732a7102' as TaskId, state: 'creating', podName: 'cli-102', native: native({ state: 'queued' }), connected: false, render, labels: { 'crewstation.io/project': 'demo', 'crewstation.io/service': 'demo' } }));
    expect(queued.workload.children).toEqual([{ kind: 'Pod', namespace: 'cs-demo', name: 'cli-102' }, { kind: 'Secret', namespace: 'cs-demo', name: 'cli-102-runner' }]);
    expect(queued.workload.render).toEqual({ pod: {
      image: 'img', workerUid: 10001, resources: render.resources, workload: 'dev-session', project: 'demo', service: 'demo', pvc: 'task-100-work', secret: 'cli-102-runner',
      nodeName: 'n', labels: { 'crewstation.io/workspace-task': env().id }, annotations: { 'crewstation.io/cli-intent': expect.stringMatching(/^[0-9a-f]{64}$/) }, workspace: { pod: 'task-100', podUid: 'p', pvcUid: 'v' },
    } });
    expect(queued.workload.conditions.slice(-2)).toEqual([{ type: 'Prepared', status: 'false' }, { type: 'Provisioning', status: 'true' }]);
    const starting = projectEnvironment(env({ state: 'creating', podName: 'cli-102', native: native({ state: 'starting', podUid: 'uid-p' }), connected: false, render }));
    expect(starting.workload.conditions.slice(-2)).toEqual([{ type: 'Prepared', status: 'true' }, { type: 'Provisioning', status: 'false' }]);
    // 没带父工作区 Pod 名的执行环境由本模块自己建：照旧的子对象与没有渲染期望。
    const owned = projectEnvironment(env({ state: 'creating', podName: 'cli-103', native: native({ state: 'queued' }), render: { ...render, execution: undefined } }));
    expect(owned.workload.render).toBeUndefined();
    expect(owned.workload.children).toEqual([{ kind: 'Pod', namespace: 'cs-demo', name: 'cli-103' }, { kind: 'Secret', namespace: 'cs-demo', name: 'cli-103-runner' }]);
  });
});
