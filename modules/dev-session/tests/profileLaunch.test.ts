import { expect, test } from 'bun:test';
import type { ProfileRevisionRef, RunnerCommand } from '@crewstation/contracts';
import { quotaExceeded } from '@crewstation/kernel';
import { agentExecutionFixture } from './agentExecutionFixture';
import type { FakeProfile } from './computeFixture';
import { fakeComputeCatalog } from './computeFixture';
import { isolatedNativeFixture } from './isolatedNativeFixture';
import { workspaceActor as actor, workspaceTask as taskId } from './workspaceFixture';

const ref: ProfileRevisionRef = { profile: 'gw', revision: 5 };

test('headless Agent：受理即登记独立执行环境（档位镜像、固定修订、占额）；子 Runner 连上后派发，launch 与材料不落 DTO；档位不可用时给出原因（RFC-006）', async () => {
  const f = agentExecutionFixture();
  const profiles: FakeProfile[] = [{ name: 'gw', protocol: 'opencode', model: 'anthropic/m', revision: 5, taskProfile: 'cli-small', secrets: { KEY: 'sk-r5' } }];
  const catalog = fakeComputeCatalog(() => profiles);
  f.deps.compute = catalog;
  const dto = await f.api.startAgent(actor, taskId, { compute: 'gw', permission: 'edit', prompt: 'hi' });
  expect(dto).toMatchObject({ state: 'preparing', compute: 'gw', profileRevision: 5, execution: { state: 'queued' } });
  expect(f.inputs[0]).toMatchObject({ purpose: 'agent', parentTaskId: taskId, agentId: dto.agentId, profile: 'cli-small', computeProfile: { name: 'gw', revision: 5 } });
  expect(f.inputs[0]!.image).toContain('registry.test/runtime/gw@sha256:');
  expect(f.routed.filter((r) => r.command.type === 'startAgent')).toHaveLength(0);
  const executionId = dto.execution!.taskId;
  f.connect(executionId);
  await f.lifecycle.dispatchExecution(executionId);
  const start = f.routed.find((r) => r.command.type === 'startAgent')!;
  expect(start.taskId).toBe(executionId);
  expect(start.command).toMatchObject({ compute: 'gw', profileRevision: 5, mode: 'interactive', initialPrompt: 'hi', launch: { protocol: 'opencode', binaryPath: '/usr/local/bin/opencode', model: 'anthropic/m' }, beforeStart: { profile: 'gw', revision: 5, secrets: { KEY: 'sk-r5' } } });
  expect((start.command as Extract<RunnerCommand, { type: 'startAgent' }>).processAttemptId).toBe(`${dto.agentId}:1`);
  expect(catalog.materials).toEqual([ref]);
  expect(JSON.stringify(dto)).not.toContain('sk-r5');
  expect(JSON.stringify(await f.api.listAgents(actor, taskId))).not.toContain('sk-r5');
  // 同一执行环境再次就绪不会重复派发。
  await f.lifecycle.dispatchExecution(executionId);
  expect(f.routed.filter((r) => r.command.type === 'startAgent')).toHaveLength(1);
  profiles[0]!.available = false;
  await expect(f.api.startAgent(actor, taskId, { compute: 'gw', permission: 'edit', prompt: 'hi' })).rejects.toMatchObject({ kind: 'precondition', details: { code: 'profile_unavailable' } });
});

test('headless Agent：额度满直接回给用户并结束受理记录；消息与取消路由到子 Runner；终态事件后回收执行环境且不重启', async () => {
  const f = agentExecutionFixture();
  f.deps.compute = fakeComputeCatalog(() => [{ name: 'gw', protocol: 'claude-code', isDefault: true }]);
  f.controls.reject = quotaExceeded('项目并发额度已满，本次 Agent 未启动，已有 Agent 与 CLI 保持运行');
  await expect(f.api.startAgent(actor, taskId, { permission: 'edit', prompt: 'x' })).rejects.toMatchObject({ kind: 'quota_exceeded' });
  expect((await f.starts.listByTask(taskId))[0]).toMatchObject({ state: 'ended', failure: expect.stringContaining('额度已满') });
  f.controls.reject = undefined;
  const dto = await f.api.startAgent(actor, taskId, { permission: 'edit', prompt: 'y' });
  const executionId = dto.execution!.taskId;
  await expect(f.api.sendMessage(actor, taskId, dto.agentId, { content: '早了' })).rejects.toMatchObject({ kind: 'precondition' });
  f.connect(executionId);
  await f.lifecycle.dispatch(dto.agentId);
  await f.api.sendMessage(actor, taskId, dto.agentId, { content: '继续' });
  await f.api.cancelAgent(actor, taskId, dto.agentId);
  expect(f.routed.filter((r) => ['sendMessage', 'cancelAgent'].includes(r.command.type)).map((r) => [r.command.type, r.taskId])).toEqual([['sendMessage', executionId], ['cancelAgent', executionId]]);
  f.emit(executionId, { kind: 'agent', event: { agentId: dto.agentId, seq: 1, at: new Date().toISOString(), type: 'cancelled' } });
  await f.lifecycle.sweep();
  expect(f.releases).toEqual([executionId]);
  expect(await f.starts.get(dto.agentId)).toMatchObject({ state: 'ended', cancelled: true, finalized: true });
  await f.lifecycle.sweep();
  expect(f.routed.filter((r) => r.command.type === 'startAgent')).toHaveLength(1);
  expect((await f.api.listAgents(actor, taskId)).find((a) => a.agentId === dto.agentId)).toMatchObject({ state: 'cancelled', execution: { taskId: executionId, state: 'finished' } });
});

test('headless Agent：执行环境失败（镜像拉不下来、旧底座）时 Agent 显示失败与原因；未派发即取消直接回收', async () => {
  const f = agentExecutionFixture();
  f.deps.compute = fakeComputeCatalog(() => [{ name: 'gw', protocol: 'claude-code', isDefault: true }]);
  const broken = await f.api.startAgent(actor, taskId, { permission: 'edit', prompt: 'x' });
  f.fail(broken.execution!.taskId, '此Agent的镜像拉取失败（ImagePullBackOff）');
  await f.lifecycle.sweep();
  expect((await f.api.listAgents(actor, taskId)).find((a) => a.agentId === broken.agentId)).toMatchObject({ state: 'failed', execution: { message: '此Agent的镜像拉取失败（ImagePullBackOff）' } });
  const waiting = await f.api.startAgent(actor, taskId, { permission: 'edit', prompt: 'y' });
  await f.api.cancelAgent(actor, taskId, waiting.agentId);
  expect(f.releases).toContain(waiting.execution!.taskId);
  expect(f.routed.filter((r) => r.command.type === 'startAgent')).toHaveLength(0);
  expect((await f.api.listAgents(actor, taskId)).find((a) => a.agentId === waiting.agentId)).toMatchObject({ state: 'cancelled' });
});

test('Agent 列表：beforeStart 事件显示“环境准备中／失败步骤”，不显示成正在执行；started 事件带档位修订；老 Agent 仍从父开发容器还原', async () => {
  const f = agentExecutionFixture();
  const at = '2026-09-16T00:00:00.000Z';
  const execution = (state: 'running' | 'succeeded' | 'failed', stepState: 'running' | 'succeeded' | 'failed') => ({ executionId: 'bse_1', agentId: 'agt_m', processAttemptId: 'agt_m:1', profile: ref, state, queuedAt: at, currentStepId: stepState === 'running' ? 'warm' : undefined, steps: [{ stepId: 'warm', name: '预热脚本', kind: 'script' as const, state: stepState }], ...(state === 'failed' ? { error: { code: 'script_failed' as const, message: '退出码 3' } } : {}) });
  f.emit(taskId, { kind: 'beforeStart', execution: execution('running', 'running') }, at);
  expect((await f.api.listAgents(actor, taskId))[0]).toMatchObject({ agentId: 'agt_m', state: 'preparing', compute: 'gw', profileRevision: 5, beforeStart: { state: 'running', currentStep: '预热脚本' } });
  f.emit(taskId, { kind: 'beforeStart', execution: execution('succeeded', 'succeeded') }, at);
  f.emit(taskId, { kind: 'agent', event: { agentId: 'agt_m', seq: 1, at, type: 'started', spec: { compute: 'gw', profileRevision: 5, protocol: 'opencode', model: 'anthropic/m', permission: 'edit' } } }, at);
  const listed = (await f.api.listAgents(actor, taskId))[0]!;
  expect(listed).toMatchObject({ state: 'running', compute: 'gw', profileRevision: 5 });
  expect(listed).not.toHaveProperty('execution');
  const g = agentExecutionFixture();
  g.emit(taskId, { kind: 'beforeStart', execution: execution('failed', 'failed') }, at);
  expect((await g.api.listAgents(actor, taskId))[0]).toMatchObject({ state: 'failed', beforeStart: { state: 'failed', failedStep: '预热脚本', error: '退出码 3' }, endedAt: at });
});

test('独立 CLI：受理记录固定档位修订，后台派发按该修订取材料并带 attempt；当前修订变化不影响已受理的 CLI', async () => {
  const f = isolatedNativeFixture();
  const profile: FakeProfile = { name: 'qa-cli', protocol: 'opencode', model: 'opencode/one', taskProfile: 'cli-small', isDefault: true, revision: 5, secrets: { KEY: 'sk-r5' } };
  const catalog = fakeComputeCatalog(() => [profile]);
  f.deps.compute = catalog;
  const terminal = await f.start();
  expect(terminal).toMatchObject({ compute: 'qa-cli', profileRevision: 5, protocol: 'opencode' });
  const start = f.commands.find((c) => c.command.type === 'startAgentTerminal')!.command as Extract<RunnerCommand, { type: 'startAgentTerminal' }>;
  expect(start).toMatchObject({ profileRevision: 5, launch: { protocol: 'opencode', binaryPath: '/usr/local/bin/opencode' }, beforeStart: { revision: 5 } });
  expect(start.processAttemptId).toBe(`${terminal.agentId}:1`);
  // 管理员保存了新修订：已受理的 CLI 后台再派发仍用受理时的修订（C17 只作用于新的受理）。
  profile.revision = 6;
  await f.run(terminal);
  expect(catalog.materials.every((r) => r.revision === 5)).toBe(true);
  const listed = await f.api.listNativeTerminals(actor, taskId);
  expect(JSON.stringify(listed)).not.toContain('sk-r5');
  expect(listed.items[0]).toMatchObject({ profileRevision: 5 });
});

test('通用终端档位：「＋ CLI」可以起，launch 为 terminal 协议且不带模型', async () => {
  const f = isolatedNativeFixture();
  f.deps.compute = fakeComputeCatalog(() => [{ name: 'tool', protocol: 'terminal', isDefault: true }]);
  const terminal = await f.start();
  expect(terminal).toMatchObject({ compute: 'tool', protocol: 'terminal' });
  const start = f.commands.find((c) => c.command.type === 'startAgentTerminal')!.command as Extract<RunnerCommand, { type: 'startAgentTerminal' }>;
  expect(start.launch).toEqual({ protocol: 'terminal', binaryPath: '/opt/tool/bin/tool', extraArgs: [], isSandbox: false });
});
