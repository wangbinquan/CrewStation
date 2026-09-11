import { describe, expect, test } from 'bun:test';
import { buildChildEnv } from './childEnvironment';
import { IsolationUnavailableError, resolveIsolation } from './privilege';
import { createLineSplitter, splitChunk } from './streamPump';

describe('resolveIsolation', () => {
  test('非 root：不降权、命令原样', () => {
    const isolation = resolveIsolation({ uid: 10001, gid: 10001, currentUid: 501, which: () => '/usr/bin/setpriv' });
    expect(isolation.enabled).toBe(false);
    expect(isolation.reason).toContain('501');
    expect(isolation.wrap(['bash', '-l'])).toEqual(['bash', '-l']);
  });
  test('root 且有 setpriv：每条命令套上 --reuid/--regid/--clear-groups', () => {
    const isolation = resolveIsolation({ uid: 10001, gid: 10002, currentUid: 0, which: (b) => (b === 'setpriv' ? '/usr/bin/setpriv' : null) });
    expect(isolation.enabled).toBe(true);
    expect(isolation.wrap(['claude', '-p'])).toEqual(['/usr/bin/setpriv', '--reuid', '10001', '--regid', '10002', '--clear-groups', '--', 'claude', '-p']);
  });
  test('root 但没有 setpriv 或 worker uid 为 0：拒绝启动', () => {
    expect(() => resolveIsolation({ uid: 10001, gid: 10001, currentUid: 0, which: () => null })).toThrow(IsolationUnavailableError);
    expect(() => resolveIsolation({ uid: 0, gid: 0, currentUid: 0, which: () => '/usr/bin/setpriv' })).toThrow(IsolationUnavailableError);
  });
});

describe('buildChildEnv', () => {
  test('剔除 runner 私有变量，降权时改写 HOME', () => {
    const base = { PATH: '/bin', CS_RUNNER_TOKEN: 'secret', CS_AGENT_ENV_FILE: '/run/x', CS_SESSION_URL: 'ws://x', CS_RUNNER_EXTRA: '1', CS_TASK_ID: 'tsk_1', HOME: '/root', EMPTY: undefined };
    const plain = buildChildEnv(base);
    expect(plain).toEqual({ PATH: '/bin', CS_TASK_ID: 'tsk_1', HOME: '/root' });
    const dropped = buildChildEnv(base, { home: '/work', extra: { TERM: 'xterm' } });
    expect(dropped).toEqual({ PATH: '/bin', CS_TASK_ID: 'tsk_1', HOME: '/work', USER: 'worker', LOGNAME: 'worker', TERM: 'xterm' });
  });
});

describe('streamPump 辅助', () => {
  test('splitChunk 与 createLineSplitter', () => {
    expect(splitChunk('')).toEqual([]);
    expect(splitChunk('abcdef', 4)).toEqual(['abcd', 'ef']);
    const lines: string[] = [];
    const splitter = createLineSplitter((line) => lines.push(line), 5);
    splitter.push('ab\ncd');
    splitter.push('e\n');
    splitter.push('toolongline');
    splitter.flush();
    expect(lines).toEqual(['ab', 'cde', 'toolo']);
  });
});
