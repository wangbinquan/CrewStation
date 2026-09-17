import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Browser, Page } from './cdp';
import { apiGet, connectBrowser, e2eAvailable, open, signIn } from './consoleSession';

/**
 * 平台能力的前台实机验收。
 *
 * 渲染用例把 fetch 打了桩，证明的是「组件按这份数据长这样」；这里不打桩，打的是当前部署：
 * 真网关、真登录、真后端。每条能力都要求它在前台真的渲染出来，且这一步没有控制台报错。
 * 后端换了字段、路由或权限判定，渲染用例可能照绿，这里会红。
 *
 * 需要本机集群 ＋ 一个开着调试端口的 Chrome，两者缺一整套自动跳过，见 tests/e2e/README.md。
 */

const available = await e2eAvailable();

/** 平台管理空间：每一项都是一条管理员能力。 */
const ADMIN_PAGES = [
  { path: '/admin', marker: '总览', capability: '管理总览与待办' },
  { path: '/admin/projects', marker: '项目管理', capability: '项目供给与生命周期' },
  { path: '/admin/users', marker: '用户与权限', capability: '用户目录与管理员裁定' },
  { path: '/admin/compute', marker: '算力档位', capability: '算力档位（RFC-001）' },
  { path: '/admin/service-plans', marker: '服务套餐', capability: '数字人服务套餐' },
  { path: '/admin/task-profiles', marker: '任务容器套餐', capability: '任务容器套餐' },
  { path: '/admin/capabilities', marker: '能力接入', capability: '接入容器与开放策略' },
  { path: '/admin/requests', marker: '申请审批', capability: '定向开放与出站申请审批' },
  { path: '/admin/egress', marker: '出站白名单', capability: '出站域名白名单' },
  { path: '/admin/gateway', marker: '网关', capability: '网关路由与放行表' },
] as const;

/** 租户空间：一个数字人项目从概览到发布、运行、设置的能力面。 */
const PROJECT_PAGES = [
  { suffix: '', marker: '正式版本', capability: '项目概览与两个部署槽' },
  { suffix: '/release', marker: '发布与上线', capability: '发布、上线与回退' },
  { suffix: '/operations', marker: '运行与诊断', capability: '健康、日志、事件投递与调用链' },
  { suffix: '/settings', marker: '项目设置', capability: '成员、可见性、配置与资源' },
] as const;

interface ProjectRef {
  readonly id: string;
  readonly name: string;
}

let browser: Browser | undefined;
let admin: Page | undefined;
let project: ProjectRef | undefined;

beforeAll(async () => {
  if (!available) return;
  browser = await connectBrowser();
  admin = await signIn(browser, 'admin', 'CrewStation Admin');
  // 不写死环境里的 ID：以当前身份问平台要一个真实项目，用例因此能跟着环境走。
  const page = await apiGet<{ items?: Array<{ id: string; name: string }> }>(admin, '/v1/projects?limit=20');
  const first = (page.items ?? [])[0];
  if (first) project = { id: first.id, name: first.name };
});

afterAll(async () => {
  await admin?.close().catch(() => undefined);
  browser?.close();
});

describe.skipIf(!available)('平台能力在当前部署的前台验收', () => {
  test('登录后拿到的是管理员身份，且顶栏给出管理空间入口', async () => {
    const me = await apiGet<{ isAdmin?: boolean }>(admin!, '/v1/me');
    expect(me.isAdmin).toBe(true);
    await open(admin!, '/');
    expect(await admin!.bodyText()).toContain('进入平台管理');
    expect(admin!.takeErrors()).toEqual([]);
  }, 30_000);

  test.each(ADMIN_PAGES.map((p) => [p.capability, p.path, p.marker] as const))(
    '管理能力「%s」在 %s 渲染出来',
    async (_capability, path, marker) => {
      await open(admin!, path);
      const text = await admin!.text();
      expect(text).toContain(marker);
      // 权限判定退化时这页会变成拒绝页而不是报错，单看 marker 抓不到，所以显式排掉。
      expect(text).not.toContain('仅平台管理员可见');
      expect(admin!.takeErrors()).toEqual([]);
    },
    30_000,
  );

  test('能力市场列出当前身份可用的数字人应用', async () => {
    await open(admin!, '/market');
    expect(await admin!.text()).toContain('能力市场');
    expect(admin!.takeErrors()).toEqual([]);
  }, 30_000);

  test.each(PROJECT_PAGES.map((p) => [p.capability, p.suffix, p.marker] as const))(
    '项目能力「%s」在项目页 %s 渲染出来',
    async (_capability, suffix, marker) => {
      expect(project, '环境里至少要有一个项目才能验收项目空间').toBeDefined();
      await open(admin!, `/projects/${project!.id}${suffix}`);
      const text = await admin!.text();
      expect(text).toContain(marker);
      expect(admin!.takeErrors()).toEqual([]);
    },
    30_000,
  );

  test('非管理员被挡在管理空间外：是拒绝页，不是登录页也不是 404', async () => {
    const visitor = await signIn(browser!, 'e2e-visitor', 'E2E 访客');
    try {
      const me = await apiGet<{ isAdmin?: boolean }>(visitor, '/v1/me');
      expect(me.isAdmin).toBe(false);
      // 顶栏不给他一个必然撞墙的入口。
      await open(visitor, '/');
      expect(await visitor.bodyText()).not.toContain('进入平台管理');
      // 直接输地址也进不去，但要说清楚这是哪、为什么、怎么回去。
      await open(visitor, '/admin');
      const denied = await visitor.text();
      expect(denied).toContain('仅平台管理员可见');
      expect(denied).toContain('回到工作台');
      expect(await visitor.eval<boolean>(`!!document.querySelector('form input[name="username"]')`)).toBe(false);
    } finally {
      await visitor.close().catch(() => undefined);
    }
  }, 60_000);
});
