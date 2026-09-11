import { describe, expect, test } from 'bun:test';
import { ApiClientError } from '@crewstation/api-client';
import { CliFailure, errorLines, EXIT, exitCodeFor, UsageError } from '../runtime/cliError';
import { jsonResponse, memoryFiles, routes, runForTest } from './cliHarness';

const PROJECT = { id: 'prj_' + '0'.repeat(32), slug: 'demo', name: '样例', kind: 'DigitalWorker', namespace: 'cs-demo', ownerUserId: 'usr_' + '0'.repeat(32), state: 'active', serviceId: 'svc_' + '0'.repeat(32), createdAt: '2026-09-11T08:00:00.000Z' };

describe('错误 → 退出码', () => {
  test('用法错误是 2，其余是 1', () => {
    expect(exitCodeFor(new UsageError('x'))).toBe(EXIT.usage);
    expect(exitCodeFor(new CliFailure('x'))).toBe(EXIT.failure);
    expect(exitCodeFor(new ApiClientError(403, { error: 'forbidden', message: 'x', details: {} }))).toBe(EXIT.failure);
    expect(exitCodeFor(new Error('boom'))).toBe(EXIT.failure);
  });
});

describe('错误渲染', () => {
  test('服务端消息原样转述，并带上状态与类别', () => {
    const lines = errorLines(new ApiClientError(403, { error: 'forbidden', message: '只有项目负责人可以切流', details: {} }));
    expect(lines[0]).toBe('错误：只有项目负责人可以切流');
    expect(lines[1]).toContain('HTTP 403');
    expect(lines[1]).toContain('forbidden');
  });

  test('412 把 details.uncommitted 的文件逐个列出来', () => {
    const error = new ApiClientError(412, { error: 'precondition', message: '存在未提交的更改', details: { uncommitted: ['src/a.ts', 'src/b.ts'] } });
    const text = errorLines(error).join('\n');
    expect(text).toContain('未提交的文件（2 个）');
    expect(text).toContain('src/a.ts');
    expect(text).toContain('src/b.ts');
    expect(text).toContain('平台不代为 git add');
  });

  test('网络失败提示查地址而不是报 HTTP 0', () => {
    const lines = errorLines(new ApiClientError(0, { error: 'unavailable', message: 'fetch failed', details: {} }));
    expect(lines[1]).toContain('检查 --api 地址');
  });

  test('用法错误带提示行', () => {
    expect(errorLines(new UsageError('缺少 --branch', '  看帮助'))).toEqual(['用法错误：缺少 --branch', '  看帮助']);
  });
});

describe('端到端的退出码', () => {
  test('成功是 0，且 stderr 干净', async () => {
    const result = await runForTest(['projects', 'list'], { respond: routes({ 'GET /v1/projects': jsonResponse(200, { items: [PROJECT] }) }) });
    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);
  });

  test('平台错误是 1，服务端消息进 stderr', async () => {
    const result = await runForTest(['projects', 'list'], {
      respond: () => jsonResponse(403, { error: 'forbidden', message: '没有权限', details: {} }),
    });
    expect(result.code).toBe(1);
    expect(result.err[0]).toContain('没有权限');
  });

  test('用法错误是 2', async () => {
    expect((await runForTest(['projects', 'show'])).code).toBe(2);
    expect((await runForTest(['nope'])).code).toBe(2);
  });

  test('帮助是 0 且走 stdout', async () => {
    const result = await runForTest(['--help']);
    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);
    expect(result.out.join('\n')).toContain('配置解析顺序');
  });

  test('坏配置文件是 1，且不回显内容', async () => {
    const files = memoryFiles({ '/home/tester/.config/crewstation/config.json': '{"token": "leak-me"' });
    const result = await runForTest(['projects', 'list'], { files, env: {} });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).not.toContain('leak-me');
  });

  test('输出里任何地方都不出现令牌', async () => {
    const result = await runForTest(['projects', 'list'], {
      env: { CS_TOKEN: 'top-secret-value' },
      respond: routes({ 'GET /v1/projects': jsonResponse(200, { items: [PROJECT] }) }),
    });
    expect([...result.out, ...result.err].join('\n')).not.toContain('top-secret-value');
  });
});
