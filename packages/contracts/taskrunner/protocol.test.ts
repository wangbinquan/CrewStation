import { describe, expect, test } from 'bun:test';
import { matchesOperationPath } from '../gateway/allowlist';
import { RunnerCommandSchema, RunnerMessageSchema, TASKRUNNER_PROTOCOL_VERSION } from './protocol';

const beforeStart = { profile: '01a0bf5d-8f4b-7c09-8050-88ba5b806778', revision: 3, contentHash: 'h', steps: [], vars: {}, secrets: {}, configFile: { kind: 'none' }, captureOutput: false };
const startAgent = { id: 'c1', type: 'startAgent', agentId: 'a1', compute: '01a0bf5d-8f4b-7c09-8050-88ba5b806778', profileRevision: 3, launch: { protocol: 'claude-code', binaryPath: '/usr/local/bin/claude' }, permission: 'edit', mode: 'interactive', beforeStart, processAttemptId: 'a1:1' };

describe('TaskRunner 协议', () => {
  test('startAgent 命令默认值：mcp、env、launch.extraArgs 与 isSandbox 有默认', () => {
    const cmd = RunnerCommandSchema.parse(startAgent);
    expect(cmd.type === 'startAgent' && cmd.mcp).toEqual([]);
    expect(cmd.type === 'startAgent' && cmd.launch).toEqual({ protocol: 'claude-code', binaryPath: '/usr/local/bin/claude', extraArgs: [], isSandbox: false });
  });
  test('协议 2（RFC-006）：启动命令必须带档位修订、launch、启动前材料与尝试标识；旧形状（driver／model）被拒', () => {
    for (const missing of ['profileRevision', 'launch', 'beforeStart', 'processAttemptId'] as const) {
      const { [missing]: _dropped, ...rest } = startAgent;
      expect(RunnerCommandSchema.safeParse(rest).success, missing).toBe(false);
    }
    expect(RunnerCommandSchema.safeParse({ id: 'c1', type: 'startAgent', agentId: 'a1', compute: 'x', driver: 'claude-code', model: 'm', permission: 'edit', mode: 'oneshot' }).success).toBe(false);
  });
  test('startAgent 拒绝通用终端协议；startAgentTerminal 接受', () => {
    const terminal = { protocol: 'terminal', binaryPath: '/opt/tool/bin/tool' };
    expect(RunnerCommandSchema.safeParse({ ...startAgent, launch: terminal }).success).toBe(false);
    const native = { ...startAgent, type: 'startAgentTerminal', launch: terminal, terminalId: 't1', runnerId: crypto.randomUUID(), requestFingerprint: 'f', cols: 80, rows: 24 };
    const { mode: _mode, ...withoutMode } = native;
    expect(RunnerCommandSchema.safeParse(withoutMode).success).toBe(true);
  });
  test('hello 只接受协议 3，并报 Runner 理解的协议而不是驱动名', () => {
    const hello = { type: 'hello', protocolVersion: TASKRUNNER_PROTOCOL_VERSION, taskId: Bun.randomUUIDv7(), runnerToken: 't', workdir: '/work', capabilities: { protocols: ['claude-code', 'opencode', 'terminal'], pty: true, preview: false } };
    expect(TASKRUNNER_PROTOCOL_VERSION).toBe(3);
    expect(RunnerMessageSchema.safeParse(hello).success).toBe(true);
    expect(RunnerMessageSchema.safeParse({ ...hello, protocolVersion: 1 }).success).toBe(false);
    expect(RunnerMessageSchema.safeParse({ ...hello, capabilities: { drivers: ['claude-code'], pty: true, preview: false, agentRuntimeConfig: 1 } }).success).toBe(false);
  });
  test('未知命令类型被拒', () => {
    expect(RunnerCommandSchema.safeParse({ id: 'c1', type: 'format-disk' }).success).toBe(false);
  });
  test('事件帧解析', () => {
    const msg = RunnerMessageSchema.parse({ type: 'event', seq: 1, at: new Date().toISOString(), event: { kind: 'terminalOutput', terminalId: 't1', data: 'hi' } });
    expect(msg.type).toBe('event');
  });
});

describe('放行表路径模板', () => {
  test('模板参数匹配', () => {
    expect(matchesOperationPath('/v1/issues/{id}', '/v1/issues/42?x=1')).toBe(true);
    expect(matchesOperationPath('/v1/issues/{id}', '/v1/issues')).toBe(false);
    expect(matchesOperationPath('/v1/issues/{id}', '/v1/issues/42/notes')).toBe(false);
  });
});
