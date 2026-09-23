import { expect, test } from 'bun:test';
import type { BeforeStartExecution, StartupRecord, StartupStage } from '@crewstation/contracts';
import type { CliStartupInput } from './nativeTerminalProjection';
import { composeCliStartup } from './nativeTerminalProjection';

const at = (second: number) => new Date(Date.UTC(2026, 8, 23, 3, 0, 0) + second * 1000).toISOString();
const kinds = (record: StartupRecord | undefined) => record?.stages.map((stage) => `${stage.kind}:${stage.state}`);
const done = (kind: StartupStage['kind'], from: number, to: number): StartupStage => ({ kind, state: 'succeeded', startedAt: at(from), endedAt: at(to), durationMs: Math.round((to - from) * 1000) });
/** task-runtime 产出的执行环境进度：排队 1–1.5 秒、容器 1.5–4.6、等待连接 4.6–5.2，连上即就绪。 */
const connected: StartupRecord = { state: 'ready', startedAt: at(1), endedAt: at(5.2), stages: [done('queue', 1, 1.5), done('container', 1.5, 4.6), done('connect', 4.6, 5.2), done('ready', 5.2, 5.2)] };
const starting = (record: Partial<CliStartupInput['record']> = {}): CliStartupInput['record'] => ({ lifecycle: 'starting', ...record });
const steps = (state: BeforeStartExecution['state'], names: Array<[string, 'pending' | 'running' | 'succeeded' | 'failed']>, extra: Partial<BeforeStartExecution> = {}): BeforeStartExecution => ({
  executionId: 'exec', agentId: 'agt', processAttemptId: 'p', profile: { profileId: '01a0bf5d-8f4b-7001-8458-107366e7de39', revision: 4 } as BeforeStartExecution['profile'],
  state, queuedAt: at(5.2), startedAt: at(5.3), ...(state === 'succeeded' || state === 'failed' || state === 'cancelled' ? { endedAt: at(5.7) } : {}),
  steps: names.map(([name, stepState], i) => ({ stepId: `s${i}`, name, kind: 'script', state: stepState } as BeforeStartExecution['steps'][number])), ...extra,
});
const compose = (input: Partial<CliStartupInput>) => composeCliStartup({ accepted: at(0.3), environment: { exists: true, startup: connected }, record: starting(), ...input });

test('执行环境还没受理：排队分配容器从 CLI 受理算起，其余未开始；升级前受理的 CLI 没有进度', () => {
  const queued = composeCliStartup({ accepted: at(0.3), environment: { exists: false }, record: starting() })!;
  expect(queued).toEqual({ state: 'running', startedAt: at(0.3), stages: [{ kind: 'queue', state: 'running', startedAt: at(0.3) }, { kind: 'container', state: 'pending' }, { kind: 'connect', state: 'pending' },
    { kind: 'prepare', state: 'pending' }, { kind: 'agent', state: 'pending' }, { kind: 'ready', state: 'pending' }] });
  expect(composeCliStartup({ accepted: at(0.3), environment: { exists: true }, record: starting() })).toBeUndefined();
});

test('连上之后：准备环境从连上起算，显示 x/y 与当前步骤；排队段从 CLI 受理算起并重算用时', () => {
  const waiting = compose({})!;
  expect(kinds(waiting)).toEqual(['queue:succeeded', 'container:succeeded', 'connect:succeeded', 'prepare:running', 'agent:pending', 'ready:pending']);
  expect(waiting.stages[0]).toEqual({ kind: 'queue', state: 'succeeded', startedAt: at(0.3), endedAt: at(1.5), durationMs: 1200 });
  expect(waiting.stages[3]).toEqual({ kind: 'prepare', state: 'running', startedAt: at(5.2) });
  const second = compose({ beforeStart: steps('running', [['安装依赖', 'succeeded'], ['写入 settings.json', 'running']], { currentStepId: 's1' }) })!;
  expect(second.stages[3]).toEqual({ kind: 'prepare', state: 'running', startedAt: at(5.2), count: { done: 1, total: 2 }, detail: '写入 settings.json' });
  const connecting = compose({ environment: { exists: true, startup: { state: 'running', startedAt: at(1), stages: [done('queue', 1, 1.5), done('container', 1.5, 4.6), { kind: 'connect', state: 'running', startedAt: at(4.6) }, { kind: 'ready', state: 'pending' }] } } })!;
  expect(kinds(connecting)).toEqual(['queue:succeeded', 'container:succeeded', 'connect:running', 'prepare:pending', 'agent:pending', 'ready:pending']);
});

test('进程拉起即就绪；没有启动前步骤时准备环境为「跳过」，Agent 启动中从连上起算', () => {
  const ready = compose({ beforeStart: steps('succeeded', [['安装依赖', 'succeeded']]), runningAt: at(10.5), record: starting({ lifecycle: 'running' }) })!;
  expect(ready.state).toBe('ready'); expect(ready.endedAt).toBe(at(10.5));
  expect(ready.stages.slice(3)).toEqual([
    { kind: 'prepare', state: 'succeeded', startedAt: at(5.2), endedAt: at(5.7), durationMs: 500, count: { done: 1, total: 1 } },
    { kind: 'agent', state: 'succeeded', startedAt: at(5.7), endedAt: at(10.5), durationMs: 4800 },
    { kind: 'ready', state: 'succeeded', startedAt: at(10.5), endedAt: at(10.5), durationMs: 0 },
  ]);
  const none = compose({ beforeStart: steps('succeeded', []) })!;
  expect(none.stages[3]).toMatchObject({ kind: 'prepare', state: 'skipped', count: { done: 0, total: 0 } });
  expect(none.stages[4]).toEqual({ kind: 'agent', state: 'running', startedAt: at(5.7), detail: '准备 CLI 配置并拉起进程' });
});

test('失败停在出错的那一段：执行环境的段、启动前步骤、进程拉不起来、受理被拒', () => {
  const env: StartupRecord = { state: 'failed', startedAt: at(1), endedAt: at(9), stages: [done('queue', 1, 1.5), { kind: 'container', state: 'failed', startedAt: at(1.5), endedAt: at(9), durationMs: 7500, error: { code: 'image-pull-failed', message: '镜像拉取失败' } }, { kind: 'connect', state: 'pending' }, { kind: 'ready', state: 'pending' }] };
  const pull = compose({ environment: { exists: true, startup: env }, record: starting({ lifecycle: 'failed', reason: 'environment-failed', endedAt: at(9.5) }) })!;
  expect(pull.state).toBe('failed'); expect(pull.endedAt).toBe(at(9));
  expect(kinds(pull)).toEqual(['queue:succeeded', 'container:failed', 'connect:pending', 'prepare:pending', 'agent:pending', 'ready:pending']);
  const script = compose({ beforeStart: steps('failed', [['安装依赖', 'failed']], { error: { message: '退出码 1' } as BeforeStartExecution['error'] }), record: starting({ lifecycle: 'failed', reason: 'before-start-failed' }) })!;
  expect(script.stages[3]).toMatchObject({ state: 'failed', error: { code: 'before-start-failed', message: '启动前步骤「安装依赖」失败：退出码 1' } });
  const binary = compose({ beforeStart: steps('succeeded', []), record: starting({ lifecycle: 'failed', reason: 'start-failed', error: 'spawn /opt/bin/nope ENOENT', endedAt: at(6) }) })!;
  expect(binary.stages[4]).toEqual({ kind: 'agent', state: 'failed', startedAt: at(5.7), endedAt: at(6), durationMs: 300, error: { code: 'agent-start-failed', message: 'spawn /opt/bin/nope ENOENT' } });
  const rejected = composeCliStartup({ accepted: at(0.3), environment: { exists: false }, record: starting({ lifecycle: 'failed', reason: 'start-failed', error: '项目并发额度已满', endedAt: at(0.8) }) })!;
  expect(rejected.stages[0]).toEqual({ kind: 'queue', state: 'failed', startedAt: at(0.3), endedAt: at(0.8), durationMs: 500, error: { code: 'admission-rejected', message: '项目并发额度已满' } });
});

test('就绪前结束：被关闭算取消（进行中的段记为跳过），Runner 重启算失败并按段归类', () => {
  const stopped = compose({ beforeStart: steps('cancelled', [['安装依赖', 'running']]), record: starting({ lifecycle: 'ended', reason: 'stopped', endedAt: at(6) }) })!;
  expect(stopped.state).toBe('cancelled');
  expect(kinds(stopped)).toEqual(['queue:succeeded', 'container:succeeded', 'connect:succeeded', 'prepare:skipped', 'agent:pending', 'ready:pending']);
  const early = composeCliStartup({ accepted: at(0.3), environment: { exists: false }, record: starting({ lifecycle: 'ended', reason: 'stopped', endedAt: at(0.9) }) })!;
  expect(early.state).toBe('cancelled'); expect(early.stages[0]).toMatchObject({ state: 'skipped', endedAt: at(0.9) });
  const cleaned = compose({ environment: { exists: true, startup: { ...connected, state: 'cancelled', stages: [done('queue', 1, 1.5), { kind: 'container', state: 'skipped', startedAt: at(1.5), endedAt: at(2), durationMs: 500 }, { kind: 'connect', state: 'pending' }, { kind: 'ready', state: 'pending' }] } } })!;
  expect(cleaned.state).toBe('cancelled');
  const restarted = compose({ beforeStart: steps('running', [['安装依赖', 'running']]), record: starting({ lifecycle: 'ended', reason: 'runner-restarted', endedAt: at(7) }) })!;
  expect(restarted.state).toBe('failed');
  expect(restarted.stages[3]).toMatchObject({ state: 'failed', endedAt: at(7), error: { code: 'before-start-failed', message: '启动没有完成' } });
});
