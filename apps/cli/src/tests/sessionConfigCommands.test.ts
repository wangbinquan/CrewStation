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

  test('RFC-022：打印启动过程——每段状态、名称、用时，其后是原因、警告或细节；--json 原样带 startup', async () => {
    const startup = { state: 'failed', startedAt: '2026-09-11T08:00:00.000Z', endedAt: '2026-09-11T08:01:05.000Z', observedAt: '2026-09-11T08:02:00.000Z', stages: [
      { kind: 'queue', state: 'succeeded', durationMs: 120 },
      { kind: 'container', state: 'succeeded', durationMs: 42_300, detail: '已调度到节点 n1 · 镜像已拉取（用时 40.1s） · 创建容器' },
      { kind: 'checkout', state: 'failed', subject: 'gone', durationMs: 65_000, error: { code: 'checkout-failed', message: '容器运行失败：checkout：Error，退出码 128' } },
      { kind: 'connect', state: 'pending' }, { kind: 'ready', state: 'pending' }] };
    const human = await runForTest(['session', 'show', 'demo'], { respond: routes({ ...LIST, [`GET /v1/projects/${PROJECT_ID}/dev-session`]: jsonResponse(200, { ...SESSION, state: 'failed', startup }) }) });
    expect(human.code).toBe(0);
    const out = human.out.join('\n');
    expect(out).toContain('启动过程（启动失败，共 1 分 05 秒）');
    expect(out).toContain('  ✓ 排队分配容器  0.1 秒');
    expect(out).toContain('  ✓ 容器启动中（调度、拉取镜像）  42 秒  已调度到节点 n1 · 镜像已拉取（用时 40.1s） · 创建容器');
    expect(out).toContain('  ✕ 检出代码（分支 gone）  1 分 05 秒  容器运行失败：checkout：Error，退出码 128');
    expect(out).toContain('  ○ 容器已启动，等待连接');
    const json = await runForTest(['session', 'show', 'demo', '--json'], { respond: routes({ ...LIST, [`GET /v1/projects/${PROJECT_ID}/dev-session`]: jsonResponse(200, { ...SESSION, startup }) }) });
    expect(JSON.parse(json.out.join('\n')).startup).toEqual(startup);
  });

  test('开会话的回执带启动过程时同样打印；没有的（升级前）不打印', async () => {
    const running = { state: 'running', startedAt: '2026-09-11T08:00:00.000Z', observedAt: '2026-09-11T08:00:01.000Z', stages: [{ kind: 'queue', state: 'succeeded', durationMs: 80 }, { kind: 'container', state: 'running', detail: '等待调度' }, { kind: 'checkout', state: 'pending', subject: 'main' }] };
    const opened = await runForTest(['session', 'open', 'demo', '--branch', 'main'], { respond: routes({ ...LIST, [`POST /v1/projects/${PROJECT_ID}/dev-session`]: jsonResponse(201, { ...SESSION, state: 'creating', startup: running }) }) });
    expect(opened.out.join('\n')).toContain('启动过程（启动中）');
    expect(opened.out.join('\n')).toContain('  ● 容器启动中（调度、拉取镜像）  等待调度');
    expect(opened.out.join('\n')).toContain('  ○ 检出代码（分支 main）');
    const legacy = await runForTest(['session', 'show', 'demo'], { respond: routes({ ...LIST, [`GET /v1/projects/${PROJECT_ID}/dev-session`]: jsonResponse(200, SESSION) }) });
    expect(legacy.out.join('\n')).not.toContain('启动过程');
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
  test('本地会话要被明确标注：关闭常规登录需要先用公司身份登录一次', async () => {
    const me = { id: id('usr', 'a'), name: '张三', email: 'z@example.com', platformRole: 'admin', isAdmin: true, memberships: [{ projectId: PROJECT_ID, role: 'owner' }], authMethod: 'password' as const };
    const result = await runForTest(['whoami'], { respond: routes({ 'GET /v1/me': jsonResponse(200, me) }) });
    expect(result.code).toBe(0);
    expect(result.out.join('\n')).toContain('用户名密码');
    expect(result.out.join('\n')).toContain('关闭常规登录需要先用公司身份登录');
  });

  test('公司身份会话不再提示那句话', async () => {
    const me = { id: id('usr', 'a'), name: '张三', email: 'z@example.com', platformRole: 'admin', isAdmin: true, memberships: [], authMethod: 'oidc' as const };
    const result = await runForTest(['whoami'], { respond: routes({ 'GET /v1/me': jsonResponse(200, me) }) });
    expect(result.out.join('\n')).toContain('公司身份（OIDC）');
    expect(result.out.join('\n')).not.toContain('关闭常规登录需要先用公司身份登录');
  });
});
