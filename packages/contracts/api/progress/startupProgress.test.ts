import { expect, test } from 'bun:test';
import { ProfileTestStageSchema } from '../compute/computeProfile';
import { DevSessionDtoSchema } from '../devSession';
import { NativeTerminalDtoSchema } from '../nativeTerminal';
import type { StartupStage } from './startupProgress';
import { StartupProgressSchema, currentStage, restartsFromScratch } from './startupProgress';

const at = (second: number) => new Date(Date.UTC(2026, 8, 23, 3, 0, second)).toISOString();
const stage = (kind: StartupStage['kind'], state: StartupStage['state'], extra: Partial<StartupStage> = {}): StartupStage => ({ kind, state, ...extra });

const cli = {
  state: 'running', startedAt: at(0), observedAt: at(6),
  stages: [
    stage('queue', 'succeeded', { startedAt: at(0), endedAt: at(1), durationMs: 600 }),
    stage('container', 'succeeded', { startedAt: at(1), endedAt: at(4), durationMs: 3300, detail: '已调度到节点 docker-desktop · 镜像节点上已有' }),
    stage('connect', 'succeeded', { startedAt: at(4), endedAt: at(5), durationMs: 600 }),
    stage('prepare', 'running', { startedAt: at(5), count: { done: 1, total: 2 }, detail: '写入 settings.json' }),
    stage('agent', 'pending'), stage('ready', 'pending'),
  ],
};

test('六段 CLI 进度按契约解析；失败段带归类与日志尾部', () => {
  expect(StartupProgressSchema.safeParse(cli).success).toBe(true);
  const failed = { ...cli, state: 'failed', endedAt: at(9), stages: [cli.stages[0], stage('container', 'failed', { startedAt: at(1), endedAt: at(9), durationMs: 8000,
    error: { code: 'image-pull-failed', message: '镜像拉取失败（ImagePullBackOff）' }, logTail: '' }), stage('connect', 'pending')] };
  expect(StartupProgressSchema.safeParse(failed).success).toBe(true);
});

test('拒绝：未知段种类、未知失败归类、负的用时、没有 observedAt、超过 16 段', () => {
  const issues = (value: unknown) => { const result = StartupProgressSchema.safeParse(value); return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.')); };
  expect(issues({ ...cli, stages: [stage('queue', 'running'), { kind: 'image', state: 'running' }] })).toContain('stages.1.kind');
  expect(issues({ ...cli, stages: [stage('queue', 'failed', { error: { code: 'oops' as never, message: 'x' } })] })).toContain('stages.0.error.code');
  expect(issues({ ...cli, stages: [stage('queue', 'succeeded', { durationMs: -1 })] })).toContain('stages.0.durationMs');
  const { observedAt: _dropped, ...stored } = cli;
  expect(issues(stored)).toContain('observedAt');
  expect(issues({ ...cli, stages: Array.from({ length: 17 }, () => stage('queue', 'pending')) })).toContain('stages');
});

test('当前段：失败优先，其次进行中、未开始，都完成时是最后一段', () => {
  expect(currentStage(cli.stages)?.kind).toBe('prepare');
  expect(currentStage([stage('queue', 'succeeded'), stage('container', 'failed'), stage('connect', 'running')])?.kind).toBe('container');
  expect(currentStage([stage('queue', 'succeeded'), stage('container', 'pending')])?.kind).toBe('container');
  expect(currentStage([stage('queue', 'succeeded'), stage('ready', 'succeeded')])?.kind).toBe('ready');
  expect(currentStage([])).toBeUndefined();
});

test('档位测试的段：新的公共种类与之前记录里的 image／runner／launch 都能读出', () => {
  for (const kind of ['queue', 'container', 'connect', 'agent', 'step', 'model', 'command', 'image', 'runner', 'launch']) {
    expect(ProfileTestStageSchema.safeParse({ id: kind, kind, name: '段', state: 'succeeded' }).success).toBe(true);
  }
  expect(ProfileTestStageSchema.safeParse({ id: 'x', kind: 'prepare-all', name: '段', state: 'succeeded' }).success).toBe(false);
  // 旧记录的细节最长 4096（模型回文摘录），不随公共段收紧到 1024。
  expect(ProfileTestStageSchema.safeParse({ id: 'model', kind: 'model', name: '真实模型轮次', state: 'failed', detail: 'x'.repeat(4096), error: { code: 'timeout', message: '超时' } }).success).toBe(true);
});

test('两个 DTO 的 startup 都是可选的：升级前的对象照常解析', () => {
  expect(NativeTerminalDtoSchema.shape.startup.safeParse(undefined).success).toBe(true);
  expect(NativeTerminalDtoSchema.shape.startup.safeParse(cli).success).toBe(true);
  expect(DevSessionDtoSchema.shape.startup.safeParse(undefined).success).toBe(true);
  expect(DevSessionDtoSchema.shape.startup.safeParse({ ...cli, stages: [stage('queue', 'succeeded'), stage('checkout', 'running', { subject: 'main' })] }).success).toBe(true);
});

test('重新开始（而不是恢复）：失败在排队、容器或检出且不是重建时才算；等待连接失败、重建失败、没失败都不算', () => {
  const failedAt = (kind: StartupStage['kind'], extra: StartupStage[] = []) => ({ stages: [...extra, stage(kind, 'failed'), stage('ready', 'pending')] });
  for (const kind of ['queue', 'container', 'checkout'] as const) expect(restartsFromScratch(failedAt(kind))).toBe(true);
  expect(restartsFromScratch(failedAt('connect', [stage('checkout', 'succeeded')]))).toBe(false);
  // 重建（带「替换旧容器」段）失败在容器段：工作卷里是原来的工作树，要走恢复。
  expect(restartsFromScratch(failedAt('container', [stage('replace', 'succeeded')]))).toBe(false);
  expect(restartsFromScratch(cli)).toBe(false);
  expect(restartsFromScratch(undefined)).toBe(false);
});
