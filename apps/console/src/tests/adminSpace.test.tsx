import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import type { RenderedApp } from './renderApp';
import { renderApp } from './renderApp';

interface Handler {
  readonly match: string;
  readonly status?: number;
  readonly body?: unknown;
  /** 不解析：用来验证 pending 态。 */
  readonly hang?: boolean;
}

const requests: string[] = [];
let handlers: Handler[] = [];
let app: RenderedApp | undefined;

const ADMIN = { id: 'usr_a', name: '管理员', email: 'a@example.com', isAdmin: true, memberships: [], demoIdentity: true };
const MEMBER = { ...ADMIN, id: 'usr_m', name: '普通成员', isAdmin: false };

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  requests.push(url);
  const handler = handlers.find((h) => url.includes(h.match));
  if (handler?.hang === true) return new Promise<Response>(() => undefined);
  if (handler === undefined) return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify(handler.body ?? {}), { status: handler.status ?? 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const asMember = (): void => { handlers = [{ match: '/v1/me', body: MEMBER }]; };
const asAdmin = (): void => { handlers = [{ match: '/v1/me', body: ADMIN }]; };

afterEach(() => {
  app?.unmount();
  app = undefined;
  requests.length = 0;
});

describe('管理空间与租户空间分离（RFC-002）', () => {
  test('两空间共用协作舱品牌入口，点击字标回工作台', async () => {
    asAdmin();
    app = await renderApp('/admin');
    expect(app.html()).toContain('src="/brand/crewstation-mark.svg"');
    await app.click('CrewStation');
    expect(app.path()).toBe('/');
    expect(app.html()).toContain('src="/brand/crewstation-mark.svg"');
  });

  test('普通成员：顶栏没有空间切换，左栏没有任何管理入口', async () => {
    asMember();
    app = await renderApp('/');
    expect(app.text()).not.toContain('进入平台管理');
    expect(app.html()).not.toContain('href="/admin');
    expect(app.text()).toContain('能力市场');
  });

  test('普通成员访问 /admin/users：拒绝页而不是 404，且有回工作台的链接', async () => {
    asMember();
    app = await renderApp('/admin/users');
    expect(app.text()).toContain('仅平台管理员可见');
    // 不是 404：路由确实解析到了管理页，只是被守卫挡住。
    expect(app.path()).toBe('/admin/users');
    expect(app.text()).not.toContain('该地址不对应工作台中的任何页面');
    // 拒绝而不是放行：管理页自身的内容一点都没渲染。
    expect(app.text()).not.toContain('设为管理员');
    expect(app.html()).toContain('href="/"');
    await app.click('回到工作台');
    expect(app.path()).toBe('/');
  });

  test('/v1/me 还在路上：既不显示管理内容也不显示拒绝页', async () => {
    handlers = [{ match: '/v1/me', hang: true }];
    app = await renderApp('/admin/users');
    expect(app.text()).not.toContain('仅平台管理员可见');
    expect(app.text()).not.toContain('设为管理员');
    // 左栏仍在：管理空间的骨架先出来，内容区显示读取中。
    expect(app.text()).toContain('用户与权限');
  });

  test('/v1/me 报错：显示错误而不是当成非管理员', async () => {
    handlers = [{ match: '/v1/me', status: 503, body: { error: 'internal', message: '身份服务不可用' } }];
    app = await renderApp('/admin/users');
    expect(app.text()).toContain('身份服务不可用');
    expect(app.text()).not.toContain('仅平台管理员可见');
  });

  test('管理员：顶栏有空间切换，管理供给与审批入口齐全', async () => {
    asAdmin();
    app = await renderApp('/admin');
    // 已经在管理空间，切换控件指回工作台。
    expect(app.text()).toContain('回到工作台');
    for (const label of ['用户与权限', '算力档位', '服务套餐', '任务容器套餐', '能力接入', '申请审批', '出站白名单', '网关']) {
      expect(app.text()).toContain(label);
    }
    // 管理空间的左栏里没有租户入口。
    expect(app.text()).not.toContain('能力市场');
  });

  test('空间往返保持项目上下文', async () => {
    asAdmin();
    app = await renderApp('/projects/prj_1/release');
    expect(app.path()).toBe('/projects/prj_1/release');
    await app.click('进入平台管理');
    expect(app.path()).toBe('/admin');
    await app.click('回到工作台');
    expect(app.path()).toBe('/projects/prj_1/release');
  });

  test('租户项目列表只要数字人；管理空间的接入容器页要另外两类', async () => {
    asAdmin();
    app = await renderApp('/projects');
    expect(requests.some((url) => url.includes('/v1/workbench/project-summaries?') && url.includes('kind=DigitalWorker'))).toBe(true);
    expect(requests.some((url) => url.includes('APIProxy'))).toBe(false);
    app.unmount();
    requests.length = 0;
    app = await renderApp('/admin/integrations');
    expect(requests.some((url) => url.includes(`/v1/projects?kind=${encodeURIComponent('APIProxy,EventProducer')}`))).toBe(true);
  });
});
