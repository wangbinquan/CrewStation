import { afterAll, describe, expect, test } from 'bun:test';
import { apiGet, e2eAvailable, e2eVisitor, open, signIn } from './consoleSession';
import { openAdminSession } from './session';

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
const visitor = e2eVisitor();
const session = available ? await openAdminSession() : undefined;
const project = session?.project;

/** 平台管理空间：每一项都是一条管理员能力。 */
const ADMIN_PAGES = [
  { path: '/admin', marker: '总览', capability: '管理总览与待办' },
  { path: '/admin/projects', marker: '项目管理', capability: '项目供给与生命周期' },
  { path: '/admin/users', marker: '用户与权限', capability: '用户目录与管理员裁定' },
  { path: '/admin/compute', marker: '算力档位', capability: '算力档位（RFC-001）' },
  { path: '/admin/service-plans', marker: '服务套餐', capability: '数字人服务套餐' },
  { path: '/admin/task-profiles', marker: '任务容器套餐', capability: '任务容器套餐' },
  { path: '/admin/projects/resource-templates?kind=service', marker: '全平台共享模板', capability: '项目管理下的共享资源规格模板' },
  { path: '/admin/capabilities', marker: '能力接入', capability: '接入容器与开放策略' },
  { path: '/admin/requests', marker: '申请审批', capability: '定向开放申请审批' },
  { path: '/admin/cluster', marker: '集群管理', capability: '受管 Kubernetes 资源与运维操作（RFC-010）' },
  { path: '/admin/gateway', marker: '网关', capability: '网关路由与放行表' },
] as const;

/** 租户空间：一个数字人项目从概览到发布、运行、设置的能力面。 */
const PROJECT_PAGES = [
  { suffix: '', marker: '正式版本', capability: '项目概览与两个部署槽' },
  { suffix: '/dev-session', marker: '开发会话', capability: '开发会话、终端工作区与工具面板（RFC-020）' },
  { suffix: '/release', marker: '发布与上线', capability: '发布、上线与回退' },
  { suffix: '/operations', marker: '运行与诊断', capability: '健康、日志、事件投递与调用链' },
  { suffix: '/settings', marker: '项目设置', capability: '成员、可见性、配置与资源' },
] as const;

afterAll(async () => {
  await session?.close();
}, 30_000);

describe.skipIf(!session)('平台能力在当前部署的前台验收', () => {
  test('登录后拿到的是管理员身份，且顶栏给出管理空间入口', async () => {
    const me = await apiGet<{ isAdmin?: boolean; platformRole: string }>(session!.admin, '/v1/me');
    expect(me.isAdmin).toBe(true); expect(me.platformRole).toBe('admin');
    await open(session!.admin, '/');
    expect(await session!.admin.eval<boolean>(`!!document.querySelector('header a[href="/admin"]')`)).toBe(true);
    expect(await session!.admin.bodyText()).toContain('能力市场');
    expect(await session!.admin.bodyText()).not.toContain('Agent 动态');
    expect(session!.admin.takeErrors()).toEqual([]);
  }, 45_000);

  test.each(ADMIN_PAGES.map((p) => [p.capability, p.path, p.marker] as const))(
    '管理能力「%s」在 %s 渲染出来',
    async (_capability, path, marker) => {
      await open(session!.admin, path);
      const text = await session!.admin.text();
      expect(text).toContain(marker);
      // 权限判定退化时这页会变成拒绝页而不是报错，单看 marker 抓不到，所以显式排掉。
      expect(text).not.toContain('仅平台管理员可见');
      expect(session!.admin.takeErrors()).toEqual([]);
    },
    45_000,
  );

  test('能力市场列出当前身份可用的数字人应用', async () => {
    await open(session!.admin, '/market');
    expect(await session!.admin.text()).toContain('能力市场');
    expect(session!.admin.takeErrors()).toEqual([]);
  }, 45_000);

  // 第二个非管理员身份在本机只能由 OIDC 或另一套口令提供（演示登录已随 RFC-005 删除）；没配就跳过，不伪造结论。
  test.skipIf(visitor === undefined)('非管理员被挡在管理空间外：是拒绝页，不是登录页也不是 404', async () => {
    const visitor_ = await signIn(session!.browser, visitor!.username, visitor!.password);
    try {
      const me = await apiGet<{ isAdmin?: boolean }>(visitor_, '/v1/me');
      expect(me.isAdmin).toBe(false);
      // 顶栏不给他一个必然撞墙的入口。
      await open(visitor_, '/');
      expect(await visitor_.bodyText()).not.toContain('进入平台管理');
      // 直接输地址也进不去，但要说清楚这是哪、为什么、怎么回去。
      await open(visitor_, '/admin');
      const denied = await visitor_.text();
      expect(denied).toContain('仅平台管理员可见');
      expect(denied).toContain('回到工作台');
      expect(await visitor_.eval<boolean>(`!!document.querySelector('form input[name="username"]')`)).toBe(false);
    } finally {
      await visitor_.close().catch(() => undefined);
    }
  }, 60_000);
});

// 项目空间要有一个已开通、有服务的数字人项目才谈得上验收。全新集群（CI 就是）里一个都没有，
// 这时整组显式跳过——比让断言在「没有对象」上失败或假装通过都更诚实。
describe.skipIf(!project)('数字人项目的能力面', () => {
  test('管理员能从旧算力入口进入资源配置，读取真实服务范围、配额和 Agent 授权', async () => {
    await open(session!.admin, `/admin/projects/${project!.id}/compute`);
    expect(await session!.admin.text()).toContain('Agent 档位范围');
    expect(await session!.admin.text()).toContain('开发容器资源套餐');
    expect(await session!.admin.text()).toContain('服务运行资源');
    expect(await session!.admin.text()).toContain('任务并发配额');
    expect(await session!.admin.eval<string>('location.pathname')).toBe(`/admin/projects/${project!.id}/resources`);
    const policy = await apiGet<{ projectId: string; revision: number }>(session!.admin, `/v1/projects/${project!.id}/compute-policy`);
    const profiles = await apiGet<{ items: unknown[] }>(session!.admin, `/v1/projects/${project!.id}/compute-profiles`);
    const service = await apiGet<{ projectId: string; revision: number }>(session!.admin, `/v1/projects/${project!.id}/service-policy`);
    const quota = await apiGet<{ maxConcurrentTasks: number; running: number }>(session!.admin, `/v1/projects/${project!.id}/quota`);
    expect(service.projectId).toBe(project!.id); expect(service.revision).toBeGreaterThanOrEqual(0);
    expect(quota.maxConcurrentTasks).toBeGreaterThanOrEqual(1); expect(quota.running).toBeGreaterThanOrEqual(0);
    expect(policy.projectId).toBe(project!.id); expect(policy.revision).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(profiles.items)).toBe(true); expect(session!.admin.takeErrors()).toEqual([]);
  }, 45_000);

  test.each(PROJECT_PAGES.map((p) => [p.capability, p.suffix, p.marker] as const))(
    '项目能力「%s」在项目页 %s 渲染出来',
    async (_capability, suffix, marker) => {
      await open(session!.admin, `/projects/${project!.id}${suffix}`);
      const text = await session!.admin.text();
      expect(text).toContain(marker);
      expect(session!.admin.takeErrors()).toEqual([]);
    },
    45_000,
  );
});
