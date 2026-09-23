import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { Stack } from '../shared/ui/Stack';
import { Tabs } from '../shared/ui/Tabs';
import { activityProjectId } from './agentActivityFixture';
import { editorWorkspaceFixture } from './editorWorkspaceFixture';
import { renderApp } from './renderApp';
import { renderElement } from './renderElement';
import { consoleStyles, sourceAt } from './sourceScan';

let rendered: Awaited<ReturnType<typeof renderElement>> | undefined, page: Awaited<ReturnType<typeof renderApp>> | undefined, fixture: ReturnType<typeof editorWorkspaceFixture> | undefined;
afterEach(async () => {
  rendered?.unmount(); rendered = undefined; page?.unmount(); page = undefined;
  await new Promise((resolve) => setTimeout(resolve, 0)); fixture?.restore(); fixture = undefined;
});

/** 样式文件里一条选择器的声明块（去掉注释）。happy-dom 不排版：排版约束只能锁在样式链上，实际位置由 e2e projectWorkspaceIa 量。 */
function declarations(file: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(sourceAt(consoleStyles(), file).code)?.[1] ?? '';
}
const column = (block: string) => /display:\s*flex\b/.test(block) && /flex-direction:\s*column/.test(block);

test('开发页撑到窗口底边：外壳、内容区、工作区一路是纵向弹性列，主区长满剩余高度，不再按视口高度猜常数', () => {
  // 2026-09-23 作者裁定：主区原用 calc(100dvh - 210px) 定高，状态条下方 1280×720／1440×900 空 47px、1920×1080 空 67px。
  const shell = 'app/layout/AppShell.module.css', workspace = 'features/dev-session/components/native/NativeWorkspace.module.css';
  expect(column(declarations(shell, '.compact'))).toBe(true);
  expect(column(declarations(shell, '.compact > .content'))).toBe(true);
  expect(declarations(shell, '.compact > .content')).toMatch(/flex:\s*1 0 auto/);
  expect(column(declarations(workspace, '.workspace'))).toBe(true);
  expect(declarations(workspace, '.workspace')).toMatch(/flex:\s*1 0 auto/);
  expect(declarations(workspace, '.stage')).toMatch(/flex:\s*1 1 0/);
  // 不再有「视口减外壳」的定高；手机上只留下限：外壳太高时主区不被压扁（390×844 实量只剩 360px），页面照旧滚动。
  const code = sourceAt(consoleStyles(), workspace).code;
  expect(code).not.toMatch(/(?:^|[;{\s])height\s*:[^;}]*dvh/);
  expect(code).toMatch(/\.stage\s*\{\s*min-height:\s*max\(360px,\s*70dvh\)/);
  // 没有会话时，开会话表单与参考面板这一层同样长满。
  expect(declarations('features/dev-session/components/panel/ToolPanel.module.css', '.noSession')).toMatch(/flex:\s*1 0 auto/);
});

test('文档式面板内容短时把最后一张卡拉到面板底边：面板至少一屏高、最后一项长满，Stack、Tabs、紧凑目录一路传下去', () => {
  // 2026-09-23 作者裁定：变更、参考等内容短时面板下方留白（1440×900 变更卡止于 641px，面板正文到 783px）。
  const panel = 'features/dev-session/components/panel/ToolPanel.module.css';
  expect(column(declarations(panel, '.flow'))).toBe(true);
  expect(declarations(panel, '.flow')).toMatch(/min-height:\s*100%/);
  expect(declarations(panel, '.flow > :last-child')).toMatch(/flex-grow:\s*1/);
  expect(declarations('shared/ui/Stack.module.css', '.fill > :last-child')).toMatch(/flex-grow:\s*1/);
  // 页签正文跟着内容长、不自成滚动区：工具面板给自己页签正文写的 overflow: auto 那条选择器也会命中嵌套的页签。
  const tabs = declarations('shared/ui/Tabs.module.css', '.tabs.fill > .panel');
  expect(column(tabs)).toBe(true); expect(tabs).toMatch(/flex:\s*1 0 auto/); expect(tabs).toMatch(/overflow:\s*visible/);
  expect(declarations('shared/ui/Tabs.module.css', '.tabs.fill > .panel > :last-child')).toMatch(/flex-grow:\s*1/);
  expect(declarations('features/catalog/components/CatalogContent.module.css', '.fill > :last-child')).toMatch(/flex-grow:\s*1/);
});

test('CLI 区的紧凑页签只作用于 CLI 区：不命中右侧工具面板，工具面板正文没有上内边距（不依赖样式加载顺序）', () => {
  // 2026-09-23 实撞：`.workspace [role="tabpanel"]` 与 `.panel [role="tabpanel"]` 同特异性，换一版打包后前者生效，
  // 工具面板正文多出 4px，操作条不再贴住顶边（e2e WS-07）。
  const workspace = 'features/dev-session/components/native/NativeWorkspace.module.css';
  const code = sourceAt(consoleStyles(), workspace).code;
  expect(code).not.toContain('.workspace [role="tabpanel"]');
  expect(code).not.toMatch(/\.workspace \[role="tab"\] \{[^}]*padding/);
  expect(declarations(workspace, '.main [role="tabpanel"]')).toMatch(/padding-top:\s*4px/);
  expect(declarations('features/dev-session/components/panel/ToolPanel.module.css', '.panel [role="tabpanel"]')).toMatch(/padding:\s*0/);
});

test('开发页三个文档式面板都按 flow 排，最后一项一路点名长满：数据与会话的 Stack，可使用资源的 Stack、Tabs 与紧凑目录；变更铺满、操作条定在顶端', async () => {
  fixture = editorWorkspaceFixture();
  const path = `/projects/${activityProjectId}/dev-session`;
  const shown = () => [...document.querySelector('aside[aria-label="工具面板"] [role="tabpanel"]')!.children].find((node) => !(node as HTMLElement).hidden)!;
  const classes = (node: Element | null | undefined) => node?.className.split(' ') ?? [];
  page = await renderApp(`${path}?view=changes`);
  const changes = shown(); expect(classes(changes)).toEqual(['pane', 'fill']);
  const [toolbar, body] = [...changes.firstElementChild!.children];
  expect([changes.children.length, changes.firstElementChild!.tagName, toolbar!.tagName, classes(body)]).toEqual([1, 'SECTION', 'HEADER', ['body']]);
  expect(declarations('features/dev-session/components/workspace/VersionComparisonPanel.module.css', '.body')).toMatch(/overflow:\s*auto/);
  for (const view of ['data', 'session', 'reference']) {
    await page.navigate(`${path}?view=${view}`);
    const pane = shown();
    expect([view, ...classes(pane)]).toEqual([view, 'pane', 'flow']);
    if (view === 'data' || view === 'session') expect([view, ...classes(pane.lastElementChild)]).toContain('fill');
    if (view === 'reference') {
      const stack = pane.lastElementChild, tabs = stack?.lastElementChild, body = [...tabs?.children ?? []].find((node) => node.getAttribute('role') === 'tabpanel');
      expect([classes(stack).includes('fill'), classes(tabs).includes('fill'), classes(body?.lastElementChild).includes('fill')]).toEqual([true, true, true]);
    }
  }
});

test('Stack 与 Tabs 只在点名 fill 时长满，其余页面不受影响', async () => {
  const items = [{ value: 'a', label: 'A' }];
  rendered = await renderElement(<>
    <Stack data-testid="plain"><p>甲</p></Stack>
    <Stack fill data-testid="filled"><p>乙</p></Stack>
    <Tabs label="主题" items={items} value="a" onChange={() => {}}><p>丙</p></Tabs>
    <Tabs fill label="主题二" items={items} value="a" onChange={() => {}}><p>丁</p></Tabs>
  </>, {});
  const host = rendered.host;
  expect(host.querySelector('[data-testid="plain"]')!.className).toBe('stack');
  expect(host.querySelector('[data-testid="filled"]')!.className).toBe('stack fill');
  expect([...host.querySelectorAll('[role="tablist"]')].map((list) => list.parentElement!.parentElement!.className)).toEqual(['tabs', 'tabs fill']);
});

// 2026-09-23 实机：没有会话时「开始开发」卡片与下面的「打开参考」只隔约 2px。样式要给这一行留一档间距。
test('没有会话时「打开参考」那一行与上面的开始开发卡片隔开一档间距', () => {
  const css = sourceAt(consoleStyles(), 'features/dev-session/components/panel/ToolPanel.module.css').code;
  expect(css).toMatch(/\.noSessionMain > \.note \{[^}]*margin-top: var\(--cs-space-2\);/);
});
