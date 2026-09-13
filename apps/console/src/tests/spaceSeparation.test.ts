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
    // RFC-003 全局入口改为市场与数字人项目；管理空间边界继续保持。
    expect(nav.code).toContain("t('nav.market')");
    expect(nav.code).toContain("t('nav.projects')");
  });

  test('管理左栏的供给与审批入口及守卫都在管理布局这一侧', () => {
    const nav = sourceAt(files, 'layout/AdminNav.tsx');
    for (const path of ['/admin/users', '/admin/compute', '/admin/service-plans', '/admin/task-profiles', '/admin/capabilities', '/admin/requests', '/admin/egress', '/admin/gateway']) {
      expect(nav.code).toContain(`'${path}'`);
    }
    expect(sourceAt(files, 'layout/AdminLayout.tsx').code).toContain('<AdminGuard>');
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
