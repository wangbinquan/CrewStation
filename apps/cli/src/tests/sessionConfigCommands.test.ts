import { describe, expect, test } from 'bun:test';
import { jsonResponse, routes, runForTest } from './cliHarness';

const id = (prefix: string, tail: string) => `${prefix}_${tail.padEnd(32, '0')}`;
const PROJECT_ID = id('prj', 'a');
const TASK_ID = id('tsk', 'a');

const DEMO = {
  id: PROJECT_ID, slug: 'demo', name: '最小样例', kind: 'DigitalWorker', namespace: 'cs-demo',
  ownerUserId: id('usr', 'a'), state: 'active', serviceId: id('svc', 'a'), createdAt: '2026-09-11T08:00:00.000Z',
};
const LIST = { 'GET /v1/projects': jsonResponse(200, { items: [DEMO] }) };

const SESSION = {
  taskId: TASK_ID, projectId: PROJECT_ID, state: 'running', branch: 'main', podName: 'dev-demo-0',
  previewHost: 'dev.demo.cs.localhost', preview: 'ready', createdBy: id('usr', 'a'),
  createdAt: '2026-09-11T08:00:00.000Z', lastActivityAt: '2026-09-11T08:30:00.000Z',
};

describe('session open', () => {
  test('分支进请求体，走 POST /v1/projects/:id/dev-session', async () => {
    const result = await runForTest(['session', 'open', 'demo', '--branch', 'feature/x'], {
      respond: routes({ ...LIST, [`POST /v1/projects/${PROJECT_ID}/dev-session`]: jsonResponse(201, SESSION) }),
    });
    expect(result.code).toBe(0);
    expect(result.calls.find((call) => call.method === 'POST')?.body).toEqual({ branch: 'feature/x' });
    expect(result.out.join('\n')).toContain(TASK_ID);
  });

  test('缺 --branch 是用法错误', async () => {
    expect((await runForTest(['session', 'open', 'demo'], { respond: routes(LIST) })).code).toBe(2);
  });

  test('已有会话时服务端 409，退出码 1', async () => {
    const result = await runForTest(['session', 'open', 'demo', '--branch', 'main'], {
      respond: routes({ ...LIST, [`POST /v1/projects/${PROJECT_ID}/dev-session`]: jsonResponse(409, { error: 'conflict', message: '该项目已有开发会话', details: {} }) }),
    });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('已有开发会话');
  });
});

describe('session show', () => {
  test('有会话时列字段', async () => {
    const result = await runForTest(['session', 'show', 'demo'], {
      respond: routes({ ...LIST, [`GET /v1/projects/${PROJECT_ID}/dev-session`]: jsonResponse(200, SESSION) }),
    });
    expect(result.code).toBe(0);
    expect(result.out.join('\n')).toContain('dev.demo.cs.localhost');
  });

  test('没有会话不是错误：退出码 0，--json 输出 null', async () => {
    const notFound = jsonResponse(404, { error: 'not_found', message: '没有开发会话', details: {} });
    const human = await runForTest(['session', 'show', 'demo'], { respond: routes({ ...LIST, [`GET /v1/projects/${PROJECT_ID}/dev-session`]: notFound }) });
    expect(human.code).toBe(0);
    expect(human.out.join('\n')).toContain('当前没有开发会话');
    const asJson = await runForTest(['session', 'show', 'demo', '--json'], { respond: routes({ ...LIST, [`GET /v1/projects/${PROJECT_ID}/dev-session`]: notFound }) });
    expect(asJson.out.join('\n').trim()).toBe('null');
  });
});

describe('session release', () => {
  const released = { session: { ...SESSION, state: 'released' }, unpushed: ['a1b2c3d 改了首页', 'd4e5f6a 修了一个 bug'] };

  test('列出未推送的提交', async () => {
    const result = await runForTest(['session', 'release', 'demo'], {
      respond: routes({ ...LIST, [`DELETE /v1/projects/${PROJECT_ID}/dev-session`]: jsonResponse(200, released) }),
    });
    expect(result.code).toBe(0);
    const text = result.out.join('\n');
    expect(text).toContain('2 个未推送的提交');
    expect(text).toContain('a1b2c3d 改了首页');
  });

  test('--force 进查询串', async () => {
    const result = await runForTest(['session', 'release', 'demo', '--force'], {
      respond: routes({ ...LIST, [`DELETE /v1/projects/${PROJECT_ID}/dev-session?force=true`]: jsonResponse(200, { ...released, unpushed: [] }) }),
    });
    expect(result.code).toBe(0);
    expect(result.calls.some((call) => call.url.endsWith('?force=true'))).toBe(true);
    expect(result.out.join('\n')).toContain('没有未推送的提交');
  });
});

describe('config list', () => {
  const items = [
    { name: 'PUBLIC_TITLE', env: 'production', isSecret: false, value: '数字人样例', version: 3, updatedBy: id('usr', 'a'), updatedAt: '2026-09-11T08:00:00.000Z' },
    { name: 'DB_PASSWORD', env: 'production', isSecret: true, version: 5, updatedBy: id('usr', 'a'), updatedAt: '2026-09-11T08:00:00.000Z' },
  ];

  test('默认取 production', async () => {
    const result = await runForTest(['config', 'list', 'demo'], {
      respond: routes({ ...LIST, [`GET /v1/projects/${PROJECT_ID}/config/production`]: jsonResponse(200, { items }) }),
    });
    expect(result.code).toBe(0);
    expect(result.out.join('\n')).toContain('PUBLIC_TITLE');
    expect(result.out.join('\n')).toContain('<secret>');
  });

  test('--env development 改路径', async () => {
    const result = await runForTest(['config', 'list', 'demo', '--env', 'development'], {
      respond: routes({ ...LIST, [`GET /v1/projects/${PROJECT_ID}/config/development`]: jsonResponse(200, { items: [] }) }),
    });
    expect(result.code).toBe(0);
    expect(result.calls.some((call) => call.url.endsWith('/config/development'))).toBe(true);
  });

  test('--env 取值非法是用法错误', async () => {
    expect((await runForTest(['config', 'list', 'demo', '--env', 'staging'], { respond: routes(LIST) })).code).toBe(2);
  });

  test('服务端万一回传 Secret 取值，人读与 --json 都不会打印出来', async () => {
    const leaking = [{ ...items[1], value: 'super-secret' }];
    const route = { ...LIST, [`GET /v1/projects/${PROJECT_ID}/config/production`]: jsonResponse(200, { items: leaking }) };
    const human = await runForTest(['config', 'list', 'demo'], { respond: routes(route) });
    const asJson = await runForTest(['config', 'list', 'demo', '--json'], { respond: routes(route) });
    expect(human.out.join('\n')).not.toContain('super-secret');
    expect(asJson.out.join('\n')).not.toContain('super-secret');
    expect(JSON.parse(asJson.out.join('\n')).items[0].name).toBe('DB_PASSWORD');
  });
});

describe('whoami', () => {
  test('演示身份要被明确标注', async () => {
    const me = { id: id('usr', 'a'), name: '张三', email: 'z@example.com', isAdmin: true, memberships: [{ projectId: PROJECT_ID, role: 'owner' }], demoIdentity: true };
    const result = await runForTest(['whoami'], { respond: routes({ 'GET /v1/me': jsonResponse(200, me) }) });
    expect(result.code).toBe(0);
    expect(result.out.join('\n')).toContain('演示身份');
  });
});
