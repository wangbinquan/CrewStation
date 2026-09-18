import { describe, expect, test } from 'bun:test';
import type { AgentEvent } from '@crewstation/contracts';
import type { ProtocolProbe } from '../domain/profileTestStages';
import { absorbAgentEvent, commandVerdict, launchStage, modelVerdict } from '../domain/profileTestStages';

const at = '2026-09-18T00:00:00.000Z';
const probeOf = (events: Array<Partial<AgentEvent> & Pick<AgentEvent, 'type'>>): ProtocolProbe =>
  events.reduce<ProtocolProbe>((probe, e, i) => absorbAgentEvent(probe, { agentId: 'a', seq: i, at, ...e }), { started: false, text: '' });

describe('档位测试阶段判定（RFC-006 §6.2）', () => {
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
    const hook = probeOf([{ type: 'error', error: { code: 'before_start_failed', message: '步骤 warm 退出码 7' } }]);
    expect(modelVerdict(hook, 'x', false, true)).toMatchObject({ outcome: 'before-start-failed' });
    const silent = probeOf([{ type: 'started' }]);
    expect(modelVerdict(silent, 'x', false, true)).toMatchObject({ stage: { state: 'running' } });
    expect(modelVerdict(silent, 'x', true, true)).toMatchObject({ outcome: 'timeout', stage: { state: 'failed' } });
    expect(launchStage({ started: false, text: '' }, false).state).toBe('pending');
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
