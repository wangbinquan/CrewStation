import { describe, expect, test } from 'bun:test';
import { matchesOperationPath } from '../gateway/allowlist';
import { RunnerCommandSchema, RunnerMessageSchema } from './protocol';

describe('TaskRunner 协议', () => {
  test('startAgent 命令默认值', () => {
    const cmd = RunnerCommandSchema.parse({ id: 'c1', type: 'startAgent', agentId: 'a1', compute: 'sample-stub', driver: 'stub', model: 'stub/echo', permission: 'edit', mode: 'interactive' });
    expect(cmd.type === 'startAgent' && cmd.mcp).toEqual([]);
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
