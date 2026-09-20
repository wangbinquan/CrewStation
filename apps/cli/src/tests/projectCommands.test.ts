import { describe, expect, test } from 'bun:test';
import { jsonResponse, routes, runForTest } from './cliHarness';

const id = (prefix: string, tail: string) => `01a0bf5d-8f4b-7a01-800${['prj', 'usr', 'svc'].indexOf(prefix)}-${tail.padEnd(12, '0')}`;

const DEMO = {
  id: id('prj', 'a'), slug: 'demo', name: '最小样例', kind: 'DigitalWorker', namespace: 'cs-demo',
  ownerUserId: id('usr', 'a'), state: 'active', serviceId: id('svc', 'a'), createdAt: '2026-09-11T08:00:00.000Z',
};
const PROVISIONING = { ...DEMO, id: id('prj', 'b'), slug: 'wip', name: '开通中', state: 'provisioning', serviceId: undefined, message: '建仓失败' };

const LIST = { 'GET /v1/projects': jsonResponse(200, { items: [DEMO, PROVISIONING] }) };

describe('projects list', () => {
  test('人读输出是对齐的表，含 slug 与状态', async () => {
    const result = await runForTest(['projects', 'list'], { respond: routes(LIST) });
    expect(result.code).toBe(0);
    expect(result.out[0]).toContain('SLUG');
    expect(result.out.join('\n')).toContain('demo');
    expect(result.out.join('\n')).toContain('最小样例');
  });

  test('--json 原样输出 ItemsPage', async () => {
    const result = await runForTest(['projects', 'list', '--json'], { respond: routes(LIST) });
    expect(JSON.parse(result.out.join('\n'))).toEqual({ items: [DEMO, PROVISIONING] });
  });

  test('走的是 GET /v1/projects', async () => {
    const result = await runForTest(['projects', 'list'], { respond: routes(LIST) });
    expect(result.calls.map((call) => `${call.method} ${call.url}`)).toEqual(['GET http://console.cs.localhost/v1/projects']);
  });
});

describe('项目定位：slug 还是 ID', () => {
  test('UUIDv7 直接取详情，不拉列表或按名称查找', async () => {
    const result = await runForTest(['projects', 'show', DEMO.id], {
      respond: routes({ [`GET /v1/projects/${DEMO.id}`]: jsonResponse(200, DEMO) }),
    });
    expect(result.code).toBe(0);
    expect(result.calls).toHaveLength(1);
    expect(result.out.join('\n')).toContain('最小样例');
  });

  test('slug 先列表后匹配', async () => {
    const result = await runForTest(['projects', 'show', 'demo', '--json'], { respond: routes(LIST) });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out.join('\n'))).toEqual(DEMO);
  });

  test('slug 找不到时列出可见项目，退出码 1', async () => {
    const result = await runForTest(['projects', 'show', 'nope'], { respond: routes(LIST) });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('没有可见的项目 nope');
    expect(result.err.join('\n')).toContain('demo');
    expect(result.err.join('\n')).toContain('wip');
  });
});

describe('projects branches', () => {
  const branches = {
    items: [
      { name: 'main', headSha: 'abcdef1234567890', isDefault: true, behindPreview: 0, behindProd: 2 },
      { name: 'feature/x', headSha: '1234567890abcdef', isDefault: false, behindPreview: null, behindProd: null },
    ],
  };

  test('落后数为 null 时显示“未知”而不是 0', async () => {
    const result = await runForTest(['projects', 'branches', 'demo'], {
      respond: routes({ ...LIST, [`GET /v1/projects/${DEMO.id}/branches`]: jsonResponse(200, branches) }),
    });
    expect(result.code).toBe(0);
    const text = result.out.join('\n');
    expect(text).toContain('未知');
    expect(text).toContain('abcdef123456');
  });

  test('--json 不改写服务端形状', async () => {
    const result = await runForTest(['projects', 'branches', 'demo', '--json'], {
      respond: routes({ ...LIST, [`GET /v1/projects/${DEMO.id}/branches`]: jsonResponse(200, branches) }),
    });
    expect(JSON.parse(result.out.join('\n'))).toEqual(branches);
  });
});
