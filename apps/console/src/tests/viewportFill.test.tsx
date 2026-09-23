import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act, useRef } from 'react';
import { useViewportFill } from '../shared/lib/useViewportFill';
import { DataTable } from '../shared/ui/DataTable';
import { renderElement } from './renderElement';
import { consoleSources, consoleStyles, sourceAt } from './sourceScan';

// 2026-09-23 作者裁定：调用链、集群管理（拓扑与资源清单）、项目「部署与运行形态」宽屏长满一屏、各栏各自滚动，整页不出纵向滚动条。
// 高度由共享的 useViewportFill 量到窗口底边；happy-dom 不排版，铺满一屏的约束锁在样式链上，实际高度由 e2e clusterLayout 量。
let rendered: Awaited<ReturnType<typeof renderElement>> | undefined;
const NativeObserver = globalThis.ResizeObserver;
afterEach(() => { rendered?.unmount(); rendered = undefined; globalThis.ResizeObserver = NativeObserver; });

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  useViewportFill(ref);
  return <main style={{ paddingBottom: '24px' }}><div><p>页头与页签</p><div ref={ref} data-fill-host="" /></div></main>;
}
const fillHost = () => document.querySelector<HTMLElement>('[data-fill-host]')!;
const fill = () => fillHost().style.getPropertyValue('--viewport-fill');
const at = (top: number) => { fillHost().getBoundingClientRect = () => new DOMRect(0, top, 1000, 400); };

/** 样式文件里一个 at 规则块（如 `@media (min-width: 1100px)`）的正文：按花括号配对截取，已去掉注释。 */
function atBlock(file: string, prelude: string): string {
  const code = sourceAt(consoleStyles(), file).code, open = code.indexOf('{', code.indexOf(`${prelude} {`));
  if (code.indexOf(`${prelude} {`) < 0) throw new Error(`${file} 里没有 ${prelude}`);
  for (let i = open, depth = 0; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}' && --depth === 0) return code.slice(open + 1, i);
  }
  throw new Error(`${file} 的 ${prelude} 没有闭合`);
}
/** 一段样式正文里某条选择器（写全，如 `.workspace.hasDetail`）的声明；没有这条规则时是空串。 */
function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[{}])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}
const styles = (file: string) => sourceAt(consoleStyles(), file).code;

test('量出容器顶边到窗口底边的高度，扣掉主区的下内边距；窗口变了重量，窗口太矮时不低于 360px', async () => {
  rendered = await renderElement(<Host />, {});
  at(180); await act(async () => { window.dispatchEvent(new Event('resize')); });
  expect(fill()).toBe(`${window.innerHeight - 180 - 24}px`);
  at(window.innerHeight - 100); await act(async () => { window.dispatchEvent(new Event('resize')); });
  expect(fill()).toBe('360px');
});

test('主区与主区内容的尺寸变了也重量：外壳定高时主区自己不变，上方多出一条提示只改变内容的高度；卸载时断开', async () => {
  const observed: Element[] = []; let notify = () => {}, disconnected = 0;
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) { notify = () => callback([], this as unknown as ResizeObserver); }
    observe(target: Element) { observed.push(target); }
    unobserve() {}
    disconnect() { disconnected += 1; }
  } as unknown as typeof ResizeObserver;
  rendered = await renderElement(<Host />, {});
  const main = fillHost().closest('main')!;
  // 只比较数量与同一性：对 happy-dom 节点做 toEqual，失败时序列化节点会让整套用例像卡死（dev-gotchas）。
  expect(observed.length).toBe(2); expect(observed[0] === main && observed[1] === main.firstElementChild).toBe(true);
  at(220); act(() => notify());
  expect(fill()).toBe(`${window.innerHeight - 220 - 24}px`);
  rendered.unmount(); rendered = undefined; expect(disconnected).toBe(1);
});

test('stickyHeader 的表格不自成滚动区，表头贴住外层滚动区的顶边；缺省仍是自己横向滚动', async () => {
  rendered = await renderElement(<><DataTable columns={['名称']}><tr><td>a</td></tr></DataTable><DataTable stickyHeader columns={['名称']}><tr><td>b</td></tr></DataTable></>, {});
  expect([...document.querySelectorAll('table')].map((table) => table.parentElement!.className)).toEqual(['scroll', 'sticky']);
  const css = styles('shared/ui/DataTable.module.css');
  for (const part of [/position:\s*sticky/, /top:\s*0/, /background:/]) expect(rule(css, '.sticky th')).toMatch(part);
  expect(rule(css, '.scroll')).toMatch(/overflow-x:\s*auto/); expect(rule(css, '.sticky')).toBe('');
});

test('形态图工作区：宽屏整块高度取 --viewport-fill，图框与详情栏各自滚动；视口常数、sticky 与改写 main 的规则都不再有', () => {
  const file = 'shared/ui/topology/Topology.module.css', wide = atBlock(file, '@media (min-width: 1100px)'), code = styles(file);
  expect(rule(wide, '.page')).toMatch(/height:\s*var\(--viewport-fill/); expect(rule(wide, '.page')).toMatch(/flex-direction:\s*column/);
  for (const part of [/flex:\s*1 1 0/, /min-height:\s*0/, /align-items:\s*stretch/, /grid-template-rows:\s*minmax\(0, 1fr\)/]) expect(rule(wide, '.workspace')).toMatch(part);
  expect(rule(wide, '.workspace.hasDetail')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 380px/);
  expect(rule(wide, '.main')).toMatch(/grid-template-rows:\s*minmax\(0, 1fr\) auto/);
  expect(rule(wide, '.stage')).toMatch(/grid-template-rows:\s*minmax\(0, 1fr\)/);
  expect(rule(wide, '.detail')).toMatch(/overflow-y:\s*auto/); expect(rule(wide, '.detail')).toMatch(/min-height:\s*0/);
  expect(rule(code, '.frame')).toMatch(/overflow:\s*auto/);
  // 此前的做法：详情 sticky、按视口常数限高、有详情时把壳层 main 的 overflow 放开。
  expect(code).not.toMatch(/\d+d?vh/); expect(code).not.toMatch(/position:\s*sticky/); expect(code).not.toContain(':global(main)');
});

test('资源清单：宽屏整块高度取 --viewport-fill，清单与详情两栏各自滚动，清单卡只让表格区滚动', () => {
  const file = 'features/cluster/components/Cluster.module.css', wide = atBlock(file, '@media (min-width: 1100px)'), code = styles(file);
  expect(rule(wide, '.inventory')).toMatch(/height:\s*var\(--viewport-fill/); expect(rule(code, '.inventory')).toMatch(/flex-direction:\s*column/);
  for (const part of [/flex:\s*1 1 0/, /min-height:\s*0/, /grid-template-rows:\s*minmax\(0, 1fr\)/]) expect(rule(wide, '.split')).toMatch(part);
  expect(rule(wide, '.split.hasDetail')).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 380px/);
  expect(rule(wide, '.list, .aside')).toMatch(/overflow-y:\s*auto/); expect(rule(wide, '.list, .aside')).toMatch(/min-height:\s*0/);
  expect(rule(wide, '.listCard')).toMatch(/height:\s*100%/); expect(rule(wide, '.listCard > :last-child')).toMatch(/min-height:\s*0/);
  expect(rule(code, '.rows')).toMatch(/overflow:\s*auto/); expect(rule(code, '.rows')).toMatch(/min-height:\s*0/);
});

test('只有一份量高的 hook：调用链原先那份挪到 shared/lib，变量名统一成 --viewport-fill', () => {
  expect(rule(atBlock('features/traces/pages/TracesPage.module.css', '@container (min-width: 761px)'), '.columns')).toMatch(/height:\s*var\(--viewport-fill/);
  expect(consoleSources().filter((file) => /export function useViewportFill\b/.test(file.code)).map((file) => file.path)).toEqual(['shared/lib/useViewportFill.ts']);
  expect([...consoleSources(), ...consoleStyles()].filter((file) => file.code.includes('--trace-fill')).map((file) => file.path)).toEqual([]);
});
