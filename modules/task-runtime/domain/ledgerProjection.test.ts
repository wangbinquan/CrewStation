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
    expect(volume).toEqual({ kind: 'volume', ref: `${env().id}/work`, projectId: env().projectId, parentId: env().id, children: [{ kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'task-100-work' }], display: { mode: 'follow-container' }, conditions: [] });
    expect(connected).toBe(true);
  });

  test('「＋ CLI」：Agent 执行挂在父工作区下，没有自己的工作卷；排队中是「未准备好」，清理中即「不要了」', () => {
    const queued = projectEnvironment(env({ id: '01a0bf5d-8f4b-7c01-8e19-e226732a7101' as TaskId, podName: 'exec-101', native: native({ state: 'queued' }), connected: false }));
    expect(queued.workload).toMatchObject({ kind: 'agent-execution', purpose: 'development-cli', parentId: env().id, display: { profile: 'OpenCode 默认', agent: 'agent-1', terminal: 'term-1' } });
    expect(queued.workload.conditions.at(-1)).toEqual({ type: 'Prepared', status: 'false' });
    expect(queued.volume).toBeUndefined();
    const cleaning = projectEnvironment(env({ native: native({ state: 'cleaning' }), state: 'releasing', message: '此CLI已结束，正在回收执行环境' }));
    expect(cleaning.workload.release).toEqual({ code: 'execution-ended', message: '此CLI已结束，正在回收执行环境' });
    expect(projectEnvironment(env({ native: native({ state: 'finished', failureReason: 'CLI 进程退出' }) })).workload.release).toEqual({ code: 'execution-ended', message: 'CLI 进程退出' });
    expect(projectEnvironment(env({ native: native({ purpose: 'subtask' }) })).workload.purpose).toBe('business-subtask');
    expect(projectEnvironment(env({ native: native({ purpose: 'agent' }) })).workload.purpose).toBe('development-agent');
  });

  test('失败：条件「失败」带启动失败的归类与原话；暂停；重建中', () => {
    const failed = projectEnvironment(env({ state: 'failed', message: '超过 5 分钟未连接', startup: { state: 'failed', startedAt: at.toISOString(), stages: [{ kind: 'connect', state: 'failed', error: { code: 'connect-timeout', message: 'x' } }] } }));
    expect(failed.workload.conditions[0]).toEqual({ type: 'Failed', status: 'true', reason: 'connect-timeout', message: '超过 5 分钟未连接' });
    expect(failed.workload.startup?.state).toBe('failed');
    expect(projectEnvironment(env({ state: 'failed' })).workload.conditions[0]).toEqual({ type: 'Failed', status: 'true', reason: 'failed', message: '平台判定失败' });
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

  test('Runner 连接条件：连着报连上；曾经连上、现在没连报断开；从没连上不报', () => {
    expect(runnerCondition(true, [])).toEqual([{ type: 'RunnerConnected', status: 'true' }]);
    expect(runnerCondition(false, [{ type: 'RunnerConnected', status: 'true' }])).toEqual([{ type: 'RunnerConnected', status: 'false', message: 'Runner 已断开' }]);
    expect(runnerCondition(false, [{ type: 'RunnerConnected', status: 'false' }])).toEqual([]);
    expect(runnerCondition(false, [])).toEqual([]);
  });
});
