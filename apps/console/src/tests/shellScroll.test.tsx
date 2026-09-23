import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { MAIN_SCROLL_SELECTOR } from '../app/layout/AppShell';
import { router as productionRouter } from '../app/router/router';
import { adminDirectoryFixture } from './adminDirectoryFixture';
import { renderApp } from './renderApp';
import { consoleStyles, sourceAt } from './sourceScan';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

const SHELL = 'app/layout/AppShell.module.css', NAV = 'app/layout/SideNav.module.css';
const NARROW = '@media (max-width: 800px)';

/** 去掉注释的样式拆成两段：宽屏（媒体块之外）与窄屏（≤800px 媒体块之内）。happy-dom 不排版，形态锁在样式上，实际位置由 e2e shellScroll 量。 */
function split(file: string): { readonly wide: string; readonly narrow: string } {
  const code = sourceAt(consoleStyles(), file).code, start = code.indexOf(NARROW);
  if (start < 0) throw new Error(`${file} 里没有 ${NARROW}`);
  let depth = 0, end = code.indexOf('{', start);
  for (let i = end; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    if (code[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  return { wide: code.slice(0, start) + code.slice(end + 1), narrow: code.slice(code.indexOf('{', start) + 1, end) };
}

/** 一段样式里某条选择器（整条精确匹配）的声明块。 */
function declarations(code: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[}{])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(code)?.[1] ?? '';
}

test('宽屏外壳正好一屏高，左栏与内容区各自滚动；窄屏外壳随内容长高、整页滚动', () => {
  // 2026-09-23 作者裁定：外壳原是 min-height: 100vh，内容一长整个文档在滚，左栏与顶栏跟着滚走（1440×900 下网关页多出 4089px）。
  const shell = split(SHELL), nav = split(NAV);
  expect(declarations(shell.wide, '.shell')).toMatch(/(?:^|[;\s])height:\s*100dvh/);
  expect(declarations(shell.wide, '.shell')).not.toMatch(/min-height/);
  expect(declarations(shell.wide, '.main')).toMatch(/overflow:\s*auto/);
  // 管理左栏在 1280×720 下约 711px，比顶栏以下的高度还高：它自己滚，不再把整页撑出滚动条。
  expect(declarations(nav.wide, '.nav')).toMatch(/overflow-y:\s*auto/);
  // 窄屏左栏变成内容上方的横条，作者裁定保持整页滚动：外壳随内容长高，内容区与横条都不自成滚动区。
  expect(declarations(shell.narrow, '.shell')).toMatch(/(?:^|[;\s])height:\s*auto/);
  expect(declarations(shell.narrow, '.shell')).toMatch(/min-height:\s*100vh/);
  expect(declarations(shell.narrow, '.main')).toMatch(/overflow:\s*visible/);
  expect(declarations(shell.narrow, '.main')).toMatch(/min-width:\s*0/);
  expect(declarations(nav.narrow, '.nav')).toMatch(/overflow-y:\s*visible/);
});

test('页面样式不改写内容区的滚动：除外壳外没有 :global(main) 的 overflow 覆盖', () => {
  // 改前算力档位编辑页与集群拓扑详情为了让吸顶生效放开过 main 的 overflow；外壳定高以后，这样的覆盖会让整页重新滚起来、左栏跟着走。
  const overrides = consoleStyles()
    .filter((file) => file.path !== SHELL && /:global\([^)]*\bmain\b[^)]*\)[^{]*\{[^}]*overflow/.test(file.code))
    .map((file) => file.path);
  expect(overrides).toEqual([]);
});

test('吸顶元素贴住内容区顶边：外壳按各形态的上内边距给出 --cs-main-sticky-top，算力档位的保存栏用它', () => {
  // 2026-09-23 实机：宽屏滚动区成了 main，保存栏 top: 0 停在 main 上内边距以下 24px，上方露出一条滚过去的内容；窄屏是窗口在滚，偏移为 0。
  const shell = split(SHELL);
  expect(declarations(shell.wide, '.main')).toMatch(/padding:\s*var\(--cs-space-5\)/);
  expect(declarations(shell.wide, '.main')).toMatch(/--cs-main-sticky-top:\s*calc\(-1 \* var\(--cs-space-5\)\)/);
  expect(declarations(shell.wide, '.compact')).toMatch(/padding:\s*8px 12px/);
  expect(declarations(shell.wide, '.compact')).toMatch(/--cs-main-sticky-top:\s*-8px/);
  expect(declarations(shell.narrow, '.main')).toMatch(/--cs-main-sticky-top:\s*0px/);
  const editor = sourceAt(consoleStyles(), 'features/admin/components/compute/ComputeEditor.module.css').code;
  expect(declarations(editor, '.saveBar')).toMatch(/position:\s*sticky/);
  expect(declarations(editor, '.saveBar')).toMatch(/top:\s*var\(--cs-main-sticky-top/);
});

test('切页时内容区回到顶部、返回时恢复原位置；resetScroll: false 的导航不动它', async () => {
  // 宽屏滚的是 main 而不是窗口：路由原先只复位窗口，外壳定高后切到别的页会停在上一页的滚动位置。
  // resetScroll: false 用在页签内的选中与切换（调用链、集群管理），那里滚动位置必须留着。
  expect(productionRouter.options.scrollToTopSelectors).toEqual([MAIN_SCROLL_SELECTOR]);
  adminDirectoryFixture();
  page = await renderApp('/admin/projects', undefined, undefined, { scrollRestoration: true });
  const main = () => document.querySelector<HTMLElement>(MAIN_SCROLL_SELECTOR)!;
  expect(main().tagName).toBe('MAIN');
  main().scrollTop = 480; main().dispatchEvent(new Event('scroll'));
  await page.navigate('/admin/users');
  expect([page.path(), main().scrollTop]).toEqual(['/admin/users', 0]);
  await page.back();
  expect([page.path(), main().scrollTop]).toEqual(['/admin/projects', 480]);
  await page.navigate('/admin/requests', { resetScroll: false });
  expect([page.path(), main().scrollTop]).toEqual(['/admin/requests', 480]);
});
