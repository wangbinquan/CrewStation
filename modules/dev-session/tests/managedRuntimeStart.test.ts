import { expect, test } from 'bun:test';
import type { AgentRuntimeMaterial, RunnerCommand, RunnerEvent, RuntimeRevisionRef } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import { agentUseCases } from '../application/agents';
import { isolatedNativeFixture } from './isolatedNativeFixture';
import { workspaceActor as actor, workspaceFixture, workspaceTask as taskId } from './workspaceFixture';

const ref: RuntimeRevisionRef = { configId: 'arc_' + 'a'.repeat(32), revision: 5 };
const materialFor = (revision: number): AgentRuntimeMaterial => ({ configId: ref.configId, configName: 'gw', revision, driver: 'opencode', contentHash: `h${revision}`, steps: [], vars: { GATEWAY: 'https://gw' }, secrets: { KEY: 'sk-r' + revision }, configFile: { kind: 'none' }, captureOutput: false });

test('headless Agent：受理时固定版本，材料随命令下发且不落 DTO；配置未就绪时返回管理员可处理的原因', async () => {
  const f = workspaceFixture();
  const requested: RuntimeRevisionRef[] = [];
  f.deps.compute.resolve = async (name) => ({ name, driver: 'opencode', model: 'anthropic/m', runtime: ref });
  f.deps.compute.runtimeMaterial = async (r) => { requested.push(r); return materialFor(r.revision); };
  const api = agentUseCases(f.deps);
  const dto = await api.startAgent(actor, taskId, { compute: 'gw', permission: 'edit', prompt: 'hi' });
  expect(dto).toMatchObject({ state: 'preparing', runtime: ref });
  expect(JSON.stringify(dto)).not.toContain('sk-r5');
  const start = f.commands.find((c) => c.type === 'startAgent') as Extract<RunnerCommand, { type: 'startAgent' }>;
  expect(start.runtime).toMatchObject({ revision: 5, secrets: { KEY: 'sk-r5' } });
  expect(start.processAttemptId).toBe(`${dto.agentId}:1`);
  expect(requested).toEqual([ref]);
  f.deps.compute.resolve = async () => { throw precondition('运行环境 gw 已停用，请管理员启用或改绑档位', { code: 'runtime_config_disabled' }); };
  await expect(api.startAgent(actor, taskId, { compute: 'gw', permission: 'edit', prompt: 'hi' })).rejects.toMatchObject({ kind: 'precondition', details: { code: 'runtime_config_disabled' } });
});

test('Agent 列表：beforeStart 事件显示“环境准备中／失败步骤”，不显示成正在执行；started 事件带运行版本', async () => {
  const f = workspaceFixture();
  const at = '2026-09-16T00:00:00.000Z';
  const execution = (state: 'running' | 'succeeded' | 'failed', stepState: 'running' | 'succeeded' | 'failed') => ({ executionId: 'bse_1', agentId: 'agt_m', processAttemptId: 'agt_m:1', runtime: ref, state, queuedAt: at, currentStepId: stepState === 'running' ? 'warm' : undefined, steps: [{ stepId: 'warm', name: '预热脚本', kind: 'script' as const, state: stepState }], ...(state === 'failed' ? { error: { code: 'script_failed' as const, message: '退出码 3' } } : {}) });
  const stored: Array<{ seq: number; at: string; event: RunnerEvent }> = [{ seq: 1, at, event: { kind: 'beforeStart', execution: execution('running', 'running') } }];
  f.deps.runner.listEvents = async () => stored;
  const api = agentUseCases(f.deps);
  expect((await api.listAgents(actor, taskId))[0]).toMatchObject({ agentId: 'agt_m', state: 'preparing', runtime: ref, beforeStart: { state: 'running', currentStep: '预热脚本' } });
  stored.push({ seq: 2, at, event: { kind: 'beforeStart', execution: execution('succeeded', 'succeeded') } });
  stored.push({ seq: 3, at, event: { kind: 'agent', event: { agentId: 'agt_m', seq: 1, at, type: 'started', spec: { compute: 'gw', driver: 'opencode', model: 'anthropic/m', permission: 'edit', runtime: ref } } } });
  expect((await api.listAgents(actor, taskId))[0]).toMatchObject({ state: 'running', compute: 'gw', runtime: ref });
  stored.length = 0;
  stored.push({ seq: 1, at, event: { kind: 'beforeStart', execution: execution('failed', 'failed') } });
  expect((await api.listAgents(actor, taskId))[0]).toMatchObject({ state: 'failed', beforeStart: { state: 'failed', failedStep: '预热脚本', error: '退出码 3' }, endedAt: at });
});

test('独立 CLI：受理记录固定运行版本，后台派发按该版本取材料并带 attempt；重试沿用同一版本', async () => {
  const f = isolatedNativeFixture();
  const requested: RuntimeRevisionRef[] = [];
  f.deps.compute.resolve = async (name) => ({ name, driver: 'opencode', model: 'opencode/one', taskProfile: 'cli-small', runtime: ref });
  f.deps.compute.runtimeMaterial = async (r) => { requested.push(r); return materialFor(r.revision); };
  const terminal = await f.start();
  expect(terminal.runtime).toEqual(ref);
  const start = f.commands.find((c) => c.command.type === 'startAgentTerminal')!.command as Extract<RunnerCommand, { type: 'startAgentTerminal' }>;
  expect(start.runtime?.revision).toBe(5);
  expect(start.processAttemptId).toBe(`${terminal.agentId}:1`);
  expect(requested).toEqual([ref]);
  // 已启用版本变化不影响已受理的 CLI：后台再派发仍用受理时的版本。
  f.deps.compute.resolve = async (name) => ({ name, driver: 'opencode', model: 'opencode/one', taskProfile: 'cli-small', runtime: { ...ref, revision: 6 } });
  await f.run(terminal);
  expect(requested.every((r) => r.revision === 5)).toBe(true);
  const listed = await f.api.listNativeTerminals(actor, taskId);
  expect(JSON.stringify(listed)).not.toContain('sk-r5');
  expect(listed.items[0]?.runtime).toEqual(ref);
});
