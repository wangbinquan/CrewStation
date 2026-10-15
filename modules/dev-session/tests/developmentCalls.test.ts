// RFC-034 v2 §4：开发 Agent 与「＋ CLI」在发出启动命令前受理一条执行记录（展示名为开发会话的分支）；
// 受理失败不派发、留给后台接续；派发被定性拒绝时补写失败终态。
import { expect, test } from 'bun:test';
import type { RunnerCommand } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { DevelopmentCall, DevelopmentCalls } from '../ports/agentCalls';
import { agentExecutionFixture } from './agentExecutionFixture';
import { computeId, computeSelector, fakeComputeCatalog } from './computeFixture';
import { isolatedNativeFixture } from './isolatedNativeFixture';
import { workspaceActor as actor, workspaceProject as projectId, workspaceTask as taskId } from './workspaceFixture';

function recording(dispatched: () => number, offline = false) {
  const accepted: Array<{ call: DevelopmentCall; dispatchedAtAcceptance: number }> = [], failed: unknown[] = [];
  const calls: DevelopmentCalls = {
    accept: async (call) => { if (offline) throw new Error('recorder offline'); accepted.push({ call, dispatchedAtAcceptance: dispatched() }); },
    fail: async (target) => { failed.push(target); },
  };
  return { calls, accepted, failed };
}
const sent = (routed: ReadonlyArray<{ command: RunnerCommand }>, type: RunnerCommand['type']) => routed.filter((entry) => entry.command.type === type).length;

test('a development Agent is accepted before startAgent; an unavailable recorder keeps it undispatched for the next pass', async () => {
  const f = agentExecutionFixture();
  f.deps.compute = fakeComputeCatalog(() => [{ name: 'gw', protocol: 'opencode', model: 'm', revision: 5 }]);
  const dto = await f.api.startAgent(actor, taskId, { compute: computeSelector('gw'), prompt: 'hi' }), executionId = dto.execution!.taskId;
  f.connect(executionId);
  f.deps.calls = recording(() => sent(f.routed, 'startAgent'), true).calls;
  await f.lifecycle.dispatchExecution(executionId).catch(() => undefined);
  expect(sent(f.routed, 'startAgent')).toBe(0);
  const r = recording(() => sent(f.routed, 'startAgent'));
  f.deps.calls = r.calls;
  await f.lifecycle.dispatchExecution(executionId);
  expect(sent(f.routed, 'startAgent')).toBe(1);
  expect(r.accepted).toHaveLength(1);
  expect(r.accepted[0]).toMatchObject({ dispatchedAtAcceptance: 0, call: { kind: 'agent', projectId, sessionId: taskId, runtimeTaskId: executionId, agentId: dto.agentId,
    profile: { id: computeId('gw'), revision: 5 }, protocol: 'opencode' } });
  expect(typeof r.accepted[0]!.call.sessionLabel).toBe('string');
});

test('a definitive start rejection ends the accepted development run as failed', async () => {
  const f = agentExecutionFixture();
  f.deps.compute = fakeComputeCatalog(() => [{ name: 'gw', protocol: 'opencode', model: 'm', revision: 5 }]);
  const dto = await f.api.startAgent(actor, taskId, { compute: computeSelector('gw'), prompt: 'hi' }), executionId = dto.execution!.taskId;
  f.connect(executionId);
  const r = recording(() => 0);
  f.deps.calls = r.calls;
  const route = f.deps.runner.sendCommand;
  f.deps.runner.sendCommand = async (target, command) => {
    if (command.type === 'startAgent') throw precondition('档位材料不可用', { code: 'profile_revision_missing' });
    return route(target, command);
  };
  await f.lifecycle.dispatchExecution(executionId);
  expect(r.accepted).toHaveLength(1);
  expect(r.failed).toEqual([{ runtimeTaskId: executionId, agentId: dto.agentId }]);
});

test('a development CLI is accepted before startAgentTerminal with its frozen profile revision', async () => {
  const f = isolatedNativeFixture();
  f.deps.compute = fakeComputeCatalog(() => [{ name: 'qa-cli', protocol: 'claude-code', isDefault: true, revision: 7 }]);
  const r = recording(() => sent(f.commands, 'startAgentTerminal'));
  f.deps.calls = r.calls;
  const terminal = await f.start();
  expect(sent(f.commands, 'startAgentTerminal')).toBe(1);
  expect(r.accepted).toHaveLength(1);
  expect(r.accepted[0]).toMatchObject({ dispatchedAtAcceptance: 0, call: { kind: 'cli', projectId, sessionId: taskId, runtimeTaskId: terminal.execution!.taskId,
    agentId: terminal.agentId, profile: { id: computeId('qa-cli'), revision: 7 }, protocol: 'claude-code' } });
});
