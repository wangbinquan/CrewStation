import { describe, expect, test } from 'bun:test';
import type { AgentEvent } from '@crewstation/contracts';
import type { ProtocolProbe } from '../domain/profileTestStages';
import { absorbAgentEvent, commandVerdict, containerStagesForTest, launchStage, modelVerdict } from '../domain/profileTestStages';

const at = '2026-09-18T00:00:00.000Z';
const probeOf = (events: Array<Partial<AgentEvent> & Pick<AgentEvent, 'type'>>): ProtocolProbe =>
  events.reduce<ProtocolProbe>((probe, e, i) => absorbAgentEvent(probe, { agentId: 'a', seq: i, at, ...e }), { started: false, text: '', diagnostics: '' });

describe('档位测试阶段判定（RFC-006 §6.2）', () => {
  test('Agent 启动中与真实模型轮次带起止与用时（RFC-022：迁到公共步骤条后这两段原来没有时间）', () => {
    const t = (second: number) => new Date(Date.parse(at) + second * 1000).toISOString();
    const running = probeOf([{ type: 'started', at: t(5) }, { type: 'session', sessionId: 'ses-1', at: t(6) }]);
    expect(running.startedAt).toBe(t(5));
    expect(launchStage(running, true, t(2))).toMatchObject({ state: 'succeeded', startedAt: t(2), endedAt: t(5), durationMs: 3000 });
    expect(modelVerdict(running, 'crewstation-test-1', false, true).stage).toMatchObject({ state: 'running', startedAt: t(5) });
    const done = probeOf([{ type: 'started', at: t(5) }, { type: 'session', sessionId: 'ses-1', at: t(6) }, { type: 'text', text: 'crewstation-test-1', at: t(7) }, { type: 'completed', result: { exitCode: 0 }, at: t(40) }]);
    expect(modelVerdict(done, 'crewstation-test-1', false, true).stage).toMatchObject({ state: 'succeeded', startedAt: t(5), endedAt: t(40), durationMs: 35_000 });
    // 还没拉起：从开始的时刻计时；没有步骤、也没发出命令时没有起点，就不写时间。
    expect(launchStage({ started: false, text: '', diagnostics: '' }, true, t(2))).toEqual({ id: 'agent', kind: 'agent', name: 'Agent 启动中', state: 'running', startedAt: t(2) });
    expect(launchStage(done, true)).not.toHaveProperty('durationMs');
    const failed = probeOf([{ type: 'started', at: t(5) }, { type: 'completed', result: { exitCode: 1 }, at: t(9) }]);
    expect(modelVerdict(failed, 'crewstation-test-1', false, true).stage).toMatchObject({ state: 'failed', startedAt: t(5), endedAt: t(9), durationMs: 4000 });
  });

  test('通过要求退出码 0、捕获到会话、回显 nonce；缺一即按分类失败并写清原因', () => {
    const ok = probeOf([{ type: 'started' }, { type: 'session', sessionId: 'ses-1' }, { type: 'text', text: 'token crewstation-test-1' }, { type: 'completed', result: { exitCode: 0 } }]);
    expect(modelVerdict(ok, 'crewstation-test-1', false, true)).toMatchObject({ stage: { state: 'succeeded' } });
    expect(launchStage(ok, true)).toMatchObject({ state: 'succeeded' });
    const noSession = probeOf([{ type: 'started' }, { type: 'text', text: 'crewstation-test-1' }, { type: 'completed', result: { exitCode: 0 } }]);
    expect(modelVerdict(noSession, 'crewstation-test-1', false, true)).toMatchObject({ outcome: 'stream-nonconforming', stage: { state: 'failed' } });
    expect(modelVerdict(noSession, 'crewstation-test-1', false, true).error).toContain('没有捕获到原生会话 ID');
    const echoOnly = probeOf([{ type: 'started' }, { type: 'session', sessionId: 's' }, { type: 'text', text: 'hello there' }, { type: 'completed' }]);
    expect(modelVerdict(echoOnly, 'crewstation-test-1', false, true)).toMatchObject({ outcome: 'stream-nonconforming', stage: { detail: '回文摘录：hello there' } });
  });

  test('没填模型的失败带上 agent-workflow 的提示；鉴权与网络错误按正则归类', () => {
    const unlicensed = probeOf([{ type: 'started' }, { type: 'error', error: { code: 'agent_reported_error', message: '您暂无该模型的使用权限' } }]);
    expect(modelVerdict(unlicensed, 'x', false, false).outcome).toBe('model-call-failed');
    expect(modelVerdict(unlicensed, 'x', false, false).error).toContain('档位没有填写模型');
    expect(modelVerdict(unlicensed, 'x', false, true).error).not.toContain('档位没有填写模型');
    const auth = probeOf([{ type: 'started' }, { type: 'error', error: { code: 'agent_failed', message: 'claude 退出码 1：Invalid API key · Please run /login' } }]);
    expect(modelVerdict(auth, 'x', false, true).outcome).toBe('auth-missing');
  });

  test('进程起不来归 spawn-failed，启动阶段失败、模型阶段跳过；启动前步骤失败归 before-start-failed；超时无终态归 timeout', () => {
    const spawn = probeOf([{ type: 'error', error: { code: 'spawn_failed', message: 'ENOENT /opt/x/bin/x' } }]);
    expect(launchStage(spawn, true)).toMatchObject({ state: 'failed', error: { code: 'spawn_failed' } });
    expect(modelVerdict(spawn, 'x', false, true)).toMatchObject({ outcome: 'spawn-failed', stage: { state: 'skipped' } });
    // 2026-09-18 实机：二进制路径错时驱动报 driver_not_installed，属于启动失败而不是「不符合协议」。
    const missing = probeOf([{ type: 'error', error: { code: 'driver_not_installed', message: 'driver binary not installed: /usr/local/bin/no-such-cli' } }]);
    expect(launchStage(missing, true)).toMatchObject({ state: 'failed', error: { code: 'driver_not_installed' } });
    expect(modelVerdict(missing, 'x', false, true)).toMatchObject({ outcome: 'spawn-failed', error: 'driver binary not installed: /usr/local/bin/no-such-cli', stage: { state: 'skipped' } });
    const hook = probeOf([{ type: 'error', error: { code: 'before_start_failed', message: '步骤 warm 退出码 7' } }]);
    expect(modelVerdict(hook, 'x', false, true)).toMatchObject({ outcome: 'before-start-failed' });
    const silent = probeOf([{ type: 'started' }]);
    expect(modelVerdict(silent, 'x', false, true)).toMatchObject({ stage: { state: 'running' } });
    expect(modelVerdict(silent, 'x', true, true)).toMatchObject({ outcome: 'timeout', stage: { state: 'failed' } });
    expect(launchStage({ started: false, text: '', diagnostics: '' }, false).state).toBe('pending');
  });

  test('厂商报错只在事件原始行里时，分类与原因取原文，摘录先打码（2026-09-18 实机：opencode 的 403 只有「运行时报告错误」）', () => {
    // 实机原样：OpenCode Zen 免费档拒绝请求时，opencode 在 stdout 打一行 error JSON；驱动归一后的错误文案只剩「运行时报告错误」。
    const freeTier = JSON.stringify({ type: 'error', sessionID: 'ses_1', error: { name: 'APIError', data: { message: "Error from provider (Console): OpenCode's free tier can only be used from within OpenCode", statusCode: 403, responseBody: '{"type":"error","error":{"type":"FreeTierError"}}' } } });
    const refused = probeOf([{ type: 'started' }, { type: 'session', sessionId: 'ses_1' }, { type: 'error', error: { code: 'runtime_error', message: '运行时报告错误' }, raw: freeTier }, { type: 'error', error: { code: 'agent_failed', message: 'opencode 退出码 1' } }]);
    const verdict = modelVerdict(refused, 'crewstation-test-1', false, true);
    expect(verdict.error).toContain('opencode 退出码 1');
    expect(verdict.error).toContain('CLI 原文：');
    expect(verdict.error).toContain('FreeTierError');
    expect(verdict.stage.log?.stdoutTail).toContain('free tier can only be used from within OpenCode');
    // 只在原始行里出现的限流字样也要能归到模型调用失败（与 agent-workflow 扫 stdout 原文一致）。
    const limited = probeOf([{ type: 'started' }, { type: 'error', error: { code: 'runtime_error', message: '运行时报告错误' }, raw: '{"type":"error","error":{"data":{"message":"Rate limit exceeded, retry later"}}}' }]);
    expect(modelVerdict(limited, 'x', false, true).outcome).toBe('model-call-failed');
    // 凭据值与凭据形状在摘录与日志里都被打码。
    const leaky = probeOf([{ type: 'started' }, { type: 'error', error: { code: 'runtime_error', message: '运行时报告错误' }, raw: 'upstream https://bob:hunter2@gw.example/v1?api_key=abc123 rejected key sk-live-SECRET-9f' }]);
    const masked = modelVerdict(leaky, 'x', false, true, ['sk-live-SECRET-9f']);
    for (const text of [masked.error ?? '', masked.stage.log?.stdoutTail ?? '']) {
      expect(text).not.toContain('sk-live-SECRET-9f');
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain('abc123');
    }
    // 通过的轮次不附原文，原始行尾部有界。
    expect(modelVerdict(probeOf([{ type: 'started' }, { type: 'session', sessionId: 's' }, { type: 'text', text: 'crewstation-test-1', raw: 'x'.repeat(20_000) }, { type: 'completed', result: { exitCode: 0 } }]), 'crewstation-test-1', false, true).error).toBeUndefined();
    expect(probeOf([{ type: 'text', text: 'a', raw: 'y'.repeat(20_000) }]).diagnostics.length).toBeLessThanOrEqual(8192);
    // started 的 raw 是驱动自己的启动规格，不算 CLI 原文。
    expect(probeOf([{ type: 'started', raw: { mode: 'oneshot', permission: 'full' } }]).diagnostics).toBe('');
  });

  test('通用终端测试命令：退出码 0 且匹配才通过；超时、非零退出、不匹配、起不来各有归类', () => {
    const base = { exitCode: 0, timedOut: false, matched: true, outputTail: 'tool 1.2.3', durationMs: 12 };
    expect(commandVerdict(base, 'tool \\d').stage).toMatchObject({ state: 'succeeded', exitCode: 0, log: { stdoutTail: 'tool 1.2.3' } });
    expect(commandVerdict({ ...base, matched: false }, 'tool \\d')).toMatchObject({ outcome: 'output-mismatch' });
    expect(commandVerdict({ ...base, exitCode: 2 }, 'x')).toMatchObject({ outcome: 'output-mismatch', error: '测试命令退出码 2' });
    expect(commandVerdict({ ...base, exitCode: null, timedOut: true }, 'x')).toMatchObject({ outcome: 'timeout' });
    expect(commandVerdict({ ...base, exitCode: null, spawnError: 'ENOENT' }, 'x')).toMatchObject({ outcome: 'spawn-failed' });
    expect(commandVerdict(undefined, 'x').stage.state).toBe('skipped');
  });
});

test('RFC-022：前三段取测试环境的启动进度（去掉「已就绪」），失败落在进行中的那段；没有进度时从排队开始', () => {
  const at = (second: number) => new Date(Date.UTC(2026, 8, 23, 3, 0, second)).toISOString();
  const startup = { state: 'running' as const, startedAt: at(0), stages: [
    { kind: 'queue' as const, state: 'succeeded' as const, startedAt: at(0), endedAt: at(1), durationMs: 1000 },
    { kind: 'container' as const, state: 'running' as const, startedAt: at(1), detail: '已调度到节点 n1 · 正在拉取镜像 x', warning: '镜像拉取失败（ImagePullBackOff）' },
    { kind: 'connect' as const, state: 'pending' as const }, { kind: 'ready' as const, state: 'pending' as const }] };
  expect(containerStagesForTest(startup).map((stage) => [stage.id, stage.kind, stage.name, stage.state])).toEqual([
    ['queue', 'queue', '排队分配容器', 'succeeded'], ['container', 'container', '容器启动中（调度、拉取镜像）', 'running'], ['connect', 'connect', '容器已启动，等待连接', 'pending']]);
  expect(containerStagesForTest(startup)[1]).toMatchObject({ detail: '已调度到节点 n1 · 正在拉取镜像 x', warning: '镜像拉取失败（ImagePullBackOff）' });
  const failed = containerStagesForTest(startup, { code: 'image-pull-failed', message: '镜像拉取失败（ImagePullBackOff）' });
  expect(failed[1]).toMatchObject({ state: 'failed', error: { code: 'image-pull-failed', message: '镜像拉取失败（ImagePullBackOff）' } });
  expect(failed.filter((stage) => stage.state === 'failed')).toHaveLength(1);
  expect(containerStagesForTest(undefined).map((stage) => stage.state)).toEqual(['running', 'pending', 'pending']);
  expect(containerStagesForTest(undefined, { code: 'timeout', message: '超时' })[0]).toMatchObject({ state: 'failed', error: { code: 'timeout' } });
  // 已结束的环境阶段：失败原因带过来（换成测试的错误形状），日志尾部不带；等待连接成功时可附一句细节。
  const ended = { ...startup, state: 'ready' as const, stages: [startup.stages[0]!, { kind: 'container' as const, state: 'failed' as const, error: { code: 'pod-exited' as const, message: '容器已退出' }, logTail: 'log' },
    { kind: 'connect' as const, state: 'succeeded' as const }] };
  expect(containerStagesForTest(ended)[1]).toEqual({ id: 'container', kind: 'container', name: '容器启动中（调度、拉取镜像）', state: 'failed', error: { code: 'pod-exited', message: '容器已退出' } });
  expect(containerStagesForTest(ended, undefined, { connect: 'Runner 协议 3' })[2]).toMatchObject({ state: 'succeeded', detail: 'Runner 协议 3' });
  // 所有段都结束了还要记失败（例如握手被拒）：落在第一个失败的段上。
  expect(containerStagesForTest(ended, { code: 'runner-protocol-mismatch', message: '协议不一致' })[1]).toMatchObject({ state: 'failed', error: { code: 'runner-protocol-mismatch' } });
});
