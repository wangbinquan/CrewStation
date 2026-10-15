// RFC-034 v2 §4：组合根把各 owner 的受理端口接到 Agent 执行记录——同一业务尝试得到同一执行行（受理幂等）、
// 开发 Agent / CLI 与档位测试的展示身份、记录器未装配时受理失败（owner 不派发）而 Session 转交只告警。
import { expect, test } from 'bun:test';
import type { ProjectId } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import { noopLogger } from '@crewstation/kernel';
import type { AgentCallAdmission, AgentCallRecorderPort } from '../../ports/agentCalls';
import { businessCallPorts, developmentCallPorts, profileTestCallPorts, sessionCallSink, stableCallId } from './agentCallPorts';

const project = '01a0bf5d-8f4b-7e30-82e1-9a99060b1192' as ProjectId;
function recorder(fail = false) {
  const accepted: AgentCallAdmission[] = [], finished: unknown[] = [], usage: unknown[] = [];
  const port: AgentCallRecorderPort = {
    accept: async (start) => { if (fail) throw new Error('database offline'); accepted.push(start); return start.id; },
    usage: async (target, snapshot) => { if (fail) throw new Error('database offline'); usage.push([target, snapshot]); },
    finish: async (target, outcome) => { if (fail) throw new Error('database offline'); finished.push([target, outcome]); },
    closeRuntimeTask: async () => 0,
  };
  return { port, accepted, finished, usage };
}

test('stable call ids are UUID-shaped and identical for the same business attempt only', () => {
  const id = stableCallId('business', 'exec-1', 1);
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(stableCallId('business', 'exec-1', 1)).toBe(id);
  expect(stableCallId('business', 'exec-1', 2)).not.toBe(id);
  expect(stableCallId('development', 'exec-1')).not.toBe(stableCallId('business', 'exec-1'));
});

test('business subtasks are accepted with their task, attempt, Agent profile and compute profile', async () => {
  const r = recorder();
  await businessCallPorts(() => r.port).accept({ projectId: project, taskId: 'task-1', taskLabel: 'Fix login', subtaskId: 'sub-1', attempt: 2, runtimeTaskId: 'rt-1', agentId: 'exec-1',
    agentKey: 'coder', agentLabel: 'Coder', profile: { id: 'p', revision: 3, name: 'GLM' }, protocol: 'opencode' });
  expect(r.accepted).toEqual([{ id: stableCallId('business', 'exec-1', 2), projectId: project, source: 'business', kind: 'subtask', taskId: 'task-1', taskLabel: 'Fix login',
    subtaskId: 'sub-1', attempt: 2, runtimeTaskId: 'rt-1', agentId: 'exec-1', agentKey: 'coder', agentLabel: 'Coder', profile: { id: 'p', revision: 3, name: 'GLM' }, protocol: 'opencode' }]);
});

test('development Agents and CLIs are runs of the session with the profile as their logical Agent; a start failure ends the run', async () => {
  const r = recorder(), ports = developmentCallPorts(() => r.port);
  const base = { projectId: project, sessionId: 'session-1', sessionLabel: 'main', runtimeTaskId: 'rt-dev', profile: { id: 'p', revision: 1, name: 'GLM' }, protocol: 'claude-code' };
  await ports.accept({ ...base, kind: 'agent', agentId: 'agent-1' });
  await ports.accept({ ...base, kind: 'cli', agentId: 'cli-1', profile: { id: 'q', revision: 2, name: null } });
  expect(r.accepted.map((call) => [call.source, call.kind, call.taskId, call.taskLabel, call.agentKey, call.agentLabel, call.subtaskId, call.attempt])).toEqual([
    ['development', 'agent', 'session-1', 'main', 'agent:p', 'Agent · GLM', null, null], ['development', 'cli', 'session-1', 'main', 'cli:q', 'CLI · q', null, null],
  ]);
  await ports.fail({ runtimeTaskId: 'rt-dev', agentId: 'agent-1' });
  expect(r.finished).toMatchObject([[{ runtimeTaskId: 'rt-dev', agentId: 'agent-1' }, { status: 'failed' }]]);
});

test('profile tests are platform runs without a project, labelled by the profile name and step', async () => {
  const r = recorder(), names = new Map([['p', 'GLM 档位']]);
  const ports = profileTestCallPorts(() => r.port, async (id) => names.get(id) ?? null);
  await ports.accept({ testId: 'test-1', runtimeTaskId: 'rt-t', agentId: 'probe', step: 'protocol', profile: { id: 'p', revision: 4 }, protocol: 'opencode' });
  await ports.accept({ testId: 'test-2', runtimeTaskId: 'rt-u', agentId: 'probe', step: 'business', profile: { id: 'gone', revision: 1 }, protocol: 'opencode' });
  expect(r.accepted.map((call) => [call.projectId, call.source, call.kind, call.taskLabel, call.agentKey, call.agentLabel, call.profile])).toEqual([
    [null, 'platform', 'profile-test', 'GLM 档位 · r4', 'profile-test:protocol', '协议轮次', { id: 'p', revision: 4, name: 'GLM 档位' }],
    [null, 'platform', 'profile-test', 'gone · r1', 'profile-test:business', '业务能力实测', { id: 'gone', revision: 1, name: null }],
  ]);
});

test('without a recorder owners must not dispatch, while Session forwarding only warns', async () => {
  await expect(businessCallPorts(() => undefined).accept({ projectId: project, taskId: 't', taskLabel: 't', subtaskId: 's', attempt: 1, runtimeTaskId: 'rt', agentId: 'a',
    agentKey: 'k', agentLabel: 'k', profile: { id: 'p', revision: 1, name: null }, protocol: 'opencode' })).rejects.toMatchObject({ kind: 'precondition' });
  const warnings: unknown[] = [], logger: Logger = { ...noopLogger, warn: (message, fields) => { warnings.push([message, fields]); } };
  const target = { runtimeTaskId: 'rt', agentId: 'a' }, snapshot = { state: 'partial' as const, models: [] };
  await sessionCallSink(() => undefined, logger).usage(target, snapshot);
  await sessionCallSink(() => recorder(true).port, logger).finish(target, { status: 'done', at: new Date() });
  expect(warnings).toEqual([['agent call observation unavailable', { operation: 'finish', ...target, error: 'Error: database offline' }]]);
  const r = recorder();
  await sessionCallSink(() => r.port, logger).usage(target, snapshot);
  expect(r.usage).toEqual([[target, snapshot]]);
});
