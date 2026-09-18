import { expect, test } from 'bun:test';
import type { ProfileRevisionRef, RunnerCommand, RunnerEvent } from '@crewstation/contracts';
import { agentUseCases } from '../application/agents';
import type { FakeProfile } from './computeFixture';
import { fakeComputeCatalog } from './computeFixture';
import { isolatedNativeFixture } from './isolatedNativeFixture';
import { workspaceActor as actor, workspaceFixture, workspaceTask as taskId } from './workspaceFixture';

const ref: ProfileRevisionRef = { profile: 'gw', revision: 5 };

test('headless Agent：受理时固定档位修订，launch 与启动前材料随命令下发且不落 DTO；档位不可用时返回管理员可处理的原因（RFC-006）', async () => {
  const f = workspaceFixture();
  const profiles: FakeProfile[] = [{ name: 'gw', protocol: 'opencode', model: 'anthropic/m', revision: 5, secrets: { KEY: 'sk-r5' } }];
  const catalog = fakeComputeCatalog(() => profiles);
  f.deps.compute = catalog;
  const api = agentUseCases(f.deps);
  const dto = await api.startAgent(actor, taskId, { compute: 'gw', permission: 'edit', prompt: 'hi' });
  expect(dto).toMatchObject({ state: 'preparing', compute: 'gw', profileRevision: 5 });
  expect(JSON.stringify(dto)).not.toContain('sk-r5');
  const start = f.commands.find((c) => c.type === 'startAgent') as Extract<RunnerCommand, { type: 'startAgent' }>;
  expect(start).toMatchObject({ compute: 'gw', profileRevision: 5, launch: { protocol: 'opencode', binaryPath: '/usr/local/bin/opencode', model: 'anthropic/m' }, beforeStart: { profile: 'gw', revision: 5, secrets: { KEY: 'sk-r5' } } });
  expect(start.processAttemptId).toBe(`${dto.agentId}:1`);
  expect(catalog.materials).toEqual([ref]);
  profiles[0]!.available = false;
  await expect(api.startAgent(actor, taskId, { compute: 'gw', permission: 'edit', prompt: 'hi' })).rejects.toMatchObject({ kind: 'precondition', details: { code: 'profile_unavailable' } });
});

test('Agent 列表：beforeStart 事件显示“环境准备中／失败步骤”，不显示成正在执行；started 事件带档位修订', async () => {
  const f = workspaceFixture();
  const at = '2026-09-16T00:00:00.000Z';
  const execution = (state: 'running' | 'succeeded' | 'failed', stepState: 'running' | 'succeeded' | 'failed') => ({ executionId: 'bse_1', agentId: 'agt_m', processAttemptId: 'agt_m:1', profile: ref, state, queuedAt: at, currentStepId: stepState === 'running' ? 'warm' : undefined, steps: [{ stepId: 'warm', name: '预热脚本', kind: 'script' as const, state: stepState }], ...(state === 'failed' ? { error: { code: 'script_failed' as const, message: '退出码 3' } } : {}) });
  const stored: Array<{ seq: number; at: string; event: RunnerEvent }> = [{ seq: 1, at, event: { kind: 'beforeStart', execution: execution('running', 'running') } }];
  f.deps.runner.listEvents = async () => stored;
  const api = agentUseCases(f.deps);
  expect((await api.listAgents(actor, taskId))[0]).toMatchObject({ agentId: 'agt_m', state: 'preparing', compute: 'gw', profileRevision: 5, beforeStart: { state: 'running', currentStep: '预热脚本' } });
  stored.push({ seq: 2, at, event: { kind: 'beforeStart', execution: execution('succeeded', 'succeeded') } });
  stored.push({ seq: 3, at, event: { kind: 'agent', event: { agentId: 'agt_m', seq: 1, at, type: 'started', spec: { compute: 'gw', profileRevision: 5, protocol: 'opencode', model: 'anthropic/m', permission: 'edit' } } } });
  expect((await api.listAgents(actor, taskId))[0]).toMatchObject({ state: 'running', compute: 'gw', profileRevision: 5 });
  stored.length = 0;
  stored.push({ seq: 1, at, event: { kind: 'beforeStart', execution: execution('failed', 'failed') } });
  expect((await api.listAgents(actor, taskId))[0]).toMatchObject({ state: 'failed', beforeStart: { state: 'failed', failedStep: '预热脚本', error: '退出码 3' }, endedAt: at });
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
