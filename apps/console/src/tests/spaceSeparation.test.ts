import { describe, expect, test } from 'bun:test';
import { consoleSources, sourceAt } from './sourceScan';

const files = consoleSources();

/**
 * RFC-002 的结构性约定。渲染测试证明「现在长这样」，这里证明「以后不会悄悄改回去」——
 * 比如有人图省事把管理入口又塞进租户左栏，或者把空间记忆挪进 localStorage。
 */
describe('两个空间的结构约定（RFC-002）', () => {
  test('租户左栏没有任何管理入口', () => {
    const nav = sourceAt(files, 'layout/WorkbenchNav.tsx');
    expect(nav.code).not.toContain('/admin');
    // 全局入口只由顶栏承接；左栏保留当前项目与返回列表，管理空间边界继续保持。
    expect(nav.code).not.toContain("t('nav.market')");
    expect(nav.code).toContain('<ProjectNavSection');
    expect(nav.code).toContain("t('nav.projects')");
    const top = sourceAt(files, 'layout/TopBar.tsx');
    expect(top.code).toContain("t('nav.market')");
    expect(top.code).toContain("t('nav.projects')");
  });

  test('管理入口只登记在管理分组定义里，只有管理左栏与管理总览读它，守卫在管理布局这一侧', () => {
    const definition = sourceAt(files, 'shared/admin/adminNavigation.ts');
    for (const path of ['/admin/users', '/admin/authentication', '/admin/compute', '/admin/projects', '/admin/capabilities', '/admin/requests', '/admin/egress', '/admin/cluster', '/admin/gateway']) {
      expect(definition.code).toContain(`'${path}'`);
    }
    expect(definition.code).not.toContain('/admin/service-plans');
    expect(definition.code).not.toContain('/admin/task-profiles');
    // 分组定义放在 shared 是为了让左栏与总览共用一份；租户一侧的任何文件读它，都等于把管理入口带出了管理空间。
    const consumers = files.filter((file) => file.code.includes('admin/adminNavigation')).map((file) => file.path).sort();
    expect(consumers).toEqual(['app/layout/AdminNav.tsx', 'features/admin/components/AdminOverviewCards.tsx']);
    expect(sourceAt(files, 'layout/AdminLayout.tsx').code).toMatch(/<AdminGuard(?:\s[^>]*)?>/);
  });

  test('管理页自己不再判 isAdmin：权限只在守卫一处', () => {
    const offenders = files.filter((file) => file.path.startsWith('features/admin/pages/')).filter((file) => file.code.includes('isAdmin')).map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  test('空间记忆只在内存里，不进 localStorage', () => {
    const memory = sourceAt(files, 'layout/spaceMemory.ts');
    expect(memory.code).not.toContain('localStorage');
    expect(memory.code).not.toContain('sessionStorage');
  });

  test('守卫不是路由级重定向：管理路由没有 beforeLoad 或 redirect', () => {
    const routes = sourceAt(files, 'features/admin/routes.ts');
    expect(routes.code).not.toContain('beforeLoad');
    expect(routes.code).not.toContain('redirect');
  });

  test('租户项目列表按 kind 过滤发生在服务端调用上，不是前端 filter', () => {
    const page = sourceAt(files, 'features/projects/model/useProjectSummaries.ts');
    expect(page.code).toContain('api.capabilities.projectSummaries');
    expect(page.code).toContain("kind: ['DigitalWorker']");
    expect(page.code).not.toMatch(/\.filter\([^)]*kind/);
  });
});
