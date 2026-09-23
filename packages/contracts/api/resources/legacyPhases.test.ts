import { describe, expect, test } from 'bun:test';
import { cliLifecycleOfPhase, phaseOfCliLifecycle, phaseOfDataResource, phaseOfDevSession, phaseOfEnvironment, phaseOfHealth, phaseOfNativeState, phaseOfRebuild, phaseOfSlotHealth } from './legacyPhases';

/** 逐行对照 RFC-025 设计 §4.3 的表。 */
describe('旧词汇 → 标准阶段（设计 §4.3）', () => {
  test('任务环境：running 按 Runner 是否连上分运行中与启动中；暂停是已结束带 Paused', () => {
    expect(phaseOfEnvironment('creating', false)).toEqual({ phase: 'provisioning' });
    expect(phaseOfEnvironment('running', true)).toEqual({ phase: 'ready', condition: { type: 'RunnerConnected', status: 'true' } });
    expect(phaseOfEnvironment('running', false)).toEqual({ phase: 'starting', condition: { type: 'RunnerConnected', status: 'false' } });
    expect(phaseOfEnvironment('paused', false)).toEqual({ phase: 'stopped', condition: { type: 'Paused', status: 'true' } });
    expect(phaseOfEnvironment('releasing', true).phase).toBe('stopping');
    expect(phaseOfEnvironment('released', false).phase).toBe('stopped');
    expect(phaseOfEnvironment('failed', false).phase).toBe('failed');
  });

  test('native.state 与开发会话', () => {
    expect((['queued', 'starting', 'running', 'cleaning', 'finished'] as const).map((s) => phaseOfNativeState(s).phase)).toEqual(['pending', 'starting', 'ready', 'stopping', 'stopped']);
    expect((['creating', 'running', 'releasing', 'released', 'failed'] as const).map((s) => phaseOfDevSession(s).phase)).toEqual(['provisioning', 'ready', 'stopping', 'stopped', 'failed']);
  });

  test('CLI lifecycle：受理了结束就是结束中；已结束与失败不受它影响', () => {
    expect((['starting', 'running', 'ended', 'failed', 'unknown'] as const).map((s) => phaseOfCliLifecycle(s).phase)).toEqual(['starting', 'ready', 'stopped', 'failed', 'degraded']);
    expect((['starting', 'running', 'unknown'] as const).map((s) => phaseOfCliLifecycle(s, true).phase)).toEqual(['stopping', 'stopping', 'stopping']);
    expect(phaseOfCliLifecycle('ended', true).phase).toBe('stopped');
    expect(phaseOfCliLifecycle('failed', true).phase).toBe('failed');
  });

  test('重建：排队与替换中是分配中、启动中是启动中，都带 Rebuilding；结束时清掉', () => {
    expect(phaseOfRebuild('queued')).toEqual({ phase: 'provisioning', condition: { type: 'Rebuilding', status: 'true' } });
    expect(phaseOfRebuild('replacing').phase).toBe('provisioning');
    expect(phaseOfRebuild('starting')).toEqual({ phase: 'starting', condition: { type: 'Rebuilding', status: 'true' } });
    expect(phaseOfRebuild('ready')).toEqual({ phase: 'ready', condition: { type: 'Rebuilding', status: 'false' } });
    expect(phaseOfRebuild('failed')).toEqual({ phase: 'failed', condition: { type: 'Rebuilding', status: 'false' } });
  });

  test('槽健康、部署健康与数据资源', () => {
    expect((['empty', 'deploying', 'ready', 'degraded', 'failed'] as const).map((s) => phaseOfSlotHealth(s).phase)).toEqual(['stopped', 'starting', 'ready', 'degraded', 'failed']);
    expect(phaseOfHealth('healthy')).toEqual({ phase: 'ready' });
    expect(phaseOfHealth('degraded')).toEqual({ phase: 'degraded' });
    expect(phaseOfHealth('crash-looping')).toEqual({ phase: 'degraded', condition: { type: 'CrashLooping', status: 'true' } });
    expect(phaseOfHealth('unhealthy')).toEqual({ phase: 'failed' });
    expect(phaseOfHealth('unknown')).toEqual({ phase: 'degraded', condition: { type: 'Observed', status: 'unknown' } });
    expect((['requested', 'provisioning', 'ready', 'failed', 'releasing', 'released'] as const).map((s) => phaseOfDataResource(s).phase)).toEqual(['pending', 'provisioning', 'ready', 'failed', 'stopping', 'stopped']);
  });
});

describe('标准阶段 → 旧接口的 CLI lifecycle（设计 §11.2）', () => {
  test('结束中仍报 running；在运行前的三个阶段都是 starting', () => {
    expect((['pending', 'provisioning', 'starting', 'ready', 'stopping', 'stopped', 'failed', 'degraded'] as const).map(cliLifecycleOfPhase))
      .toEqual(['starting', 'starting', 'starting', 'running', 'running', 'ended', 'failed', 'unknown']);
  });
});
