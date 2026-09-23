import { expect, test } from 'bun:test';
import { consoleSources } from './sourceScan';

// RFC-025 设计 §10 的守卫：页面不得自行推导资源状态。资源的阶段、原因与「结束了没有」只来自资源台账的标准记录
// （shared/resources 与 contracts 的辅助函数）；开发页 CLI 标签的结束与失败由 model/native/terminalPhase 把台账合进名册。
// 下面两条守住「新代码不再往回走」；CLI lifecycle 的旧比较是迁移中的存量，只许减少，不许增加或扩散到新文件。

/** 按 CLI lifecycle（名册的旧词汇）分支的写法：`lifecycle === '…'`、`[…].includes(….lifecycle)`。 */
const LIFECYCLE_BRANCH = /\blifecycle\s*[!=]==\s*'|\]\.includes\([^)]*\blifecycle\)/g;

/**
 * 存量（2026-09-23，RFC-025 T7 第二步之后）：CLI 的启动细节（RFC-022 步骤条、RFC-024 界面就绪）、终端的可交互与输入控制、
 * 动态菜单的轮次状态仍按名册；结束与失败已由 terminalPhase 以台账为准写回 lifecycle。第二期后续让名册的 lifecycle
 * 在服务端由记录推导（设计 §11.2），这些比较读到的就是台账的结论；迁掉一处就把这里的数字减一。
 */
const LIFECYCLE_BACKLOG: Readonly<Record<string, number>> = {
  'app/layout/activity/AgentActivityMenu.tsx': 1,
  'features/dev-session/components/native/CliDock.tsx': 1,
  'features/dev-session/components/native/NativeTerminalCard.tsx': 5,
  'features/dev-session/components/native/NativeTerminalView.tsx': 4,
  'features/dev-session/hooks/native/useCreatorClaim.ts': 4,
  'features/dev-session/model/native/terminalPhase.ts': 1,
  'shared/activity/agentActivityStore.ts': 1,
  'shared/activity/agentActivityView.ts': 6,
};

test('按 CLI lifecycle 分支的写法只在已登记的存量里，数量只减不增', () => {
  const counts: Record<string, number> = {};
  for (const file of consoleSources()) {
    if (file.path.includes('/i18n/')) continue;
    const found = (file.code.match(LIFECYCLE_BRANCH) ?? []).length;
    if (found) counts[file.path] = found;
  }
  expect(counts).toEqual(LIFECYCLE_BACKLOG);
});

/** 2026-09-23 实机：关掉的 CLI 只记在页面内存里（dismissed），离开再回来就以「不可用」回到原处。 */
const PAGE_MEMORY = /\b(?:dismissed\w*|recentlyClosed\w*|justClosed\w*|closedLocally\w*)\b/;

test('页面不在内存里另记「刚关掉／刚结束」：结束以台账为准，关掉的标签记在个人布局里', () => {
  const offenders = consoleSources().filter((file) => PAGE_MEMORY.test(file.code)).map((file) => file.path);
  expect(offenders).toEqual([]);
});
