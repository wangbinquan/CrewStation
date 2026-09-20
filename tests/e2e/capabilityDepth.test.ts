import { afterAll, describe, expect, test } from 'bun:test';
import { e2eAvailable, open } from './consoleSession';
import { openAdminSession } from './session';

/**
 * 能力深度锁。
 *
 * `platformCapabilities.test.ts` 回答「这页在不在」，这里回答「这页上的能力全不全」：
 * 页签、分区标题、主控件逐条点名。少一个页签、少一个入口，都是能力退化，光看页面标题抓不到。
 *
 * 只断言与部署状态无关的结构性能力（页签、卡片标题、主按钮），这样换一套数据也成立；
 * 具体版本号、副本数这类会变的东西不进断言。
 */

const available = await e2eAvailable();
const session = available ? await openAdminSession() : undefined;
const project = session?.project;

/** 每条 = 一块能力面，`parts` 里的每一项 = 这块能力必须暴露出来的一个入口或分区。 */
const PROJECT_DEPTH = [
  {
    capability: '发布与上线：两个槽、试用入口、发布历史',
    suffix: '/release',
    parts: ['准备发布', '正式版本', '待验证版本', '发布历史', '两个版本共用生产数据'],
  },
  {
    capability: '运行与诊断：健康、告警、日志、事件投递、调用链',
    suffix: '/operations',
    parts: ['健康状态', '告警与通知', '日志', '事件投递', '调用链回放'],
  },
  {
    capability: '项目设置：环境变量、应用展示、成员与角色、高级',
    suffix: '/settings',
    parts: ['环境变量', '应用展示', '成员与角色', '高级', '新增变量'],
  },
  {
    capability: '开发资源：五个独立主题',
    suffix: '/resources',
    parts: ['API 接口', '事件', '数据与存储', '项目与仓库', '平台接入'],
  },
  {
    capability: '成员管理：三种角色与负责人转移规则',
    suffix: '/settings?tab=members',
    parts: ['项目负责人', '开发者', 'preview 测试者', '负责人只能由管理员转移'],
  },
] as const;

const ADMIN_DEPTH = [
  {
    capability: '管理总览：三类待办与供给入口',
    path: '/admin',
    parts: ['待处理事项', '待审批 API 申请', '待审批出站申请', '开通失败', '新建数字人'],
  },
  {
    capability: '能力接入：接入容器、开放策略、事件来源',
    path: '/admin/capabilities',
    parts: ['接入容器', 'API 开放策略', '事件来源'],
  },
] as const;

afterAll(async () => {
  await session?.close();
}, 30_000);

describe.skipIf(!session)('管理能力的构成没有退化', () => {
  test.each(ADMIN_DEPTH.map((entry) => [entry.capability, entry.path, entry.parts] as const))(
    '%s',
    async (_capability, path, parts) => {
      await open(session!.admin, path);
      const text = await session!.admin.text();
      for (const part of parts) expect(text).toContain(part);
      expect(session!.admin.takeErrors()).toEqual([]);
    },
    45_000,
  );
});

// 同 platformCapabilities：没有可用的数字人项目就整组跳过，不在「没有对象」上得出假结论。
describe.skipIf(!project)('数字人项目的能力构成没有退化', () => {
  test.each(PROJECT_DEPTH.map((entry) => [entry.capability, entry.suffix, entry.parts] as const))(
    '%s',
    async (_capability, suffix, parts) => {
      await open(session!.admin, `/projects/${project!.id}${suffix}`);
      if (suffix.endsWith('tab=members')) { await session!.admin.eval(`Array.from(document.querySelectorAll('button')).find(button => button.textContent === '添加成员').click()`); await session!.admin.waitUntil(`!!document.querySelector('form select[aria-label="成员角色"]')`); }
      const text = await session!.admin.text();
      for (const part of parts) expect(text).toContain(part);
      expect(session!.admin.takeErrors()).toEqual([]);
    },
    45_000,
  );
});
