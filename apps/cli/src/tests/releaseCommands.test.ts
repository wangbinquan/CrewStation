import { describe, expect, test } from 'bun:test';
import { jsonResponse, routes, runForTest } from './cliHarness';

const id = (prefix: string, tail: string) => `${prefix}_${tail.padEnd(32, '0')}`;
const PROJECT_ID = id('prj', 'a');
const SERVICE_ID = id('svc', 'a');
const RELEASE_ID = id('rel', 'a');

const DEMO = {
  id: PROJECT_ID, slug: 'demo', name: '最小样例', kind: 'DigitalWorker', namespace: 'cs-demo',
  ownerUserId: id('usr', 'a'), state: 'active', serviceId: SERVICE_ID, createdAt: '2026-09-11T08:00:00.000Z',
};
const NO_SERVICE = { ...DEMO, id: id('prj', 'b'), slug: 'wip', state: 'provisioning', serviceId: undefined, message: '建仓失败' };
const LIST = { 'GET /v1/projects': jsonResponse(200, { items: [DEMO, NO_SERVICE] }) };

const RELEASE = {
  id: RELEASE_ID, serviceId: SERVICE_ID, tag: 'v1.2.3', commitSha: 'abcdef1234567890', branch: 'main',
  status: 'building', createdBy: id('usr', 'a'), createdAt: '2026-09-11T08:00:00.000Z', updatedAt: '2026-09-11T08:01:00.000Z',
};

describe('publish', () => {
  test('走工作台同一条路由，请求体是分支与版本', async () => {
    const result = await runForTest(['publish', 'demo', '--branch', 'main', '--version', 'minor', '--message', '加了一页'], {
      respond: routes({ ...LIST, [`POST /v1/projects/${PROJECT_ID}/publish`]: jsonResponse(202, RELEASE) }),
    });
    expect(result.code).toBe(0);
    const publishCall = result.calls.find((call) => call.method === 'POST');
    expect(publishCall?.url).toBe(`http://console.cs.localhost/v1/projects/${PROJECT_ID}/publish`);
    expect(publishCall?.body).toEqual({ branch: 'main', version: 'minor', message: '加了一页' });
    expect(result.out.join('\n')).toContain('v1.2.3');
  });

  test('不给 --version 时不发 version 字段，交给服务端按 patch 递增', async () => {
    const result = await runForTest(['publish', 'demo', '--branch', 'main'], {
      respond: routes({ ...LIST, [`POST /v1/projects/${PROJECT_ID}/publish`]: jsonResponse(202, RELEASE) }),
    });
    expect(result.calls.find((call) => call.method === 'POST')?.body).toEqual({ branch: 'main' });
  });

  test('--version 写错是用法错误（退出码 2），且不发请求', async () => {
    const result = await runForTest(['publish', 'demo', '--branch', 'main', '--version', '1.2.3'], { respond: routes(LIST) });
    expect(result.code).toBe(2);
    expect(result.calls.some((call) => call.method === 'POST')).toBe(false);
  });

  test('缺 --branch 是用法错误', async () => {
    expect((await runForTest(['publish', 'demo'], { respond: routes(LIST) })).code).toBe(2);
  });

  test('412 列出未提交的文件，退出码 1', async () => {
    const precondition = jsonResponse(412, { error: 'precondition', message: '存在未提交的更改，请先提交', details: { uncommitted: ['src/pages/home.tsx', 'README.md'] } });
    const result = await runForTest(['publish', 'demo', '--branch', 'main'], {
      respond: routes({ ...LIST, [`POST /v1/projects/${PROJECT_ID}/publish`]: precondition }),
    });
    expect(result.code).toBe(1);
    const text = result.err.join('\n');
    expect(text).toContain('存在未提交的更改，请先提交');
    expect(text).toContain('src/pages/home.tsx');
    expect(text).toContain('README.md');
  });
});

describe('releases 与 traffic：先把项目解析成服务', () => {
  test('releases list 用项目的 serviceId 查 Release', async () => {
    const result = await runForTest(['releases', 'list', 'demo', '--json'], {
      respond: routes({ ...LIST, [`GET /v1/services/${SERVICE_ID}/releases`]: jsonResponse(200, { items: [RELEASE] }) }),
    });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out.join('\n'))).toEqual({ items: [RELEASE] });
  });

  test('项目还没有服务时说清楚状态与原因', async () => {
    const result = await runForTest(['releases', 'list', 'wip'], { respond: routes(LIST) });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('还没有服务');
    expect(result.err.join('\n')).toContain('建仓失败');
  });

  test('traffic show 列出两个槽，标出在线的那个', async () => {
    const slots = {
      items: [
        { name: 'preview', active: false, replicas: 1, readyReplicas: 1, state: 'ready', host: 'preview.demo.cs.localhost', tag: 'v1.2.3' },
        { name: 'prod', active: true, replicas: 2, readyReplicas: 2, state: 'ready', host: 'demo.cs.localhost', tag: 'v1.2.2' },
      ],
    };
    const result = await runForTest(['traffic', 'show', 'demo'], {
      respond: routes({ ...LIST, [`GET /v1/services/${SERVICE_ID}/slots`]: jsonResponse(200, slots) }),
    });
    expect(result.code).toBe(0);
    expect(result.out.join('\n')).toContain('←prod');
  });
});

describe('traffic switch', () => {
  const done = {
    id: 'ts_1', serviceId: SERVICE_ID, fromSlot: 'prod', toSlot: 'preview', releaseId: RELEASE_ID,
    actorUserId: id('usr', 'a'), createdAt: '2026-09-11T09:00:00.000Z', reason: '上线 v1.2.3',
  };

  test('把 --to／--expect／--reason 原样送到切流路由', async () => {
    const result = await runForTest(['traffic', 'switch', 'demo', '--to', 'preview', '--expect', RELEASE_ID, '--reason', '上线 v1.2.3'], {
      respond: routes({ ...LIST, [`POST /v1/services/${SERVICE_ID}/traffic-switch`]: jsonResponse(200, done) }),
    });
    expect(result.code).toBe(0);
    expect(result.calls.find((call) => call.method === 'POST')?.body).toEqual({ toSlot: 'preview', expectedActiveRelease: RELEASE_ID, reason: '上线 v1.2.3' });
    expect(result.out.join('\n')).toContain('prod 流量已从 prod 切到 preview');
  });

  test('--to 取值非法时列出可选值，退出码 2', async () => {
    const result = await runForTest(['traffic', 'switch', 'demo', '--to', 'staging'], { respond: routes(LIST) });
    expect(result.code).toBe(2);
    expect(result.err.join('\n')).toContain('preview');
    expect(result.err.join('\n')).toContain('prod');
  });

  test('缺 --to 是用法错误', async () => {
    expect((await runForTest(['traffic', 'switch', 'demo'], { respond: routes(LIST) })).code).toBe(2);
  });

  test('服务端用 409 挡下迟到的切流时转述原因', async () => {
    const conflict = jsonResponse(409, { error: 'conflict', message: '在线槽的 Release 与 expectedActiveRelease 不一致', details: {} });
    const result = await runForTest(['traffic', 'switch', 'demo', '--to', 'prod'], {
      respond: routes({ ...LIST, [`POST /v1/services/${SERVICE_ID}/traffic-switch`]: conflict }),
    });
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('expectedActiveRelease');
  });
});
