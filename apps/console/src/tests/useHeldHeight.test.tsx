import './domSetup';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { useHeldHeight } from '../shared/lib/useHeldHeight';

/**
 * happy-dom 不做排版，offsetHeight 恒为 0；这里让它读元素上的 data-h，用例据此模拟「满内容 → 载入中一行 → 新内容」的高度变化。
 */
const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
beforeEach(() => { Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return Number((this as HTMLElement).getAttribute('data-h') ?? 0); } }); });
let root: Root | undefined, host: HTMLDivElement | undefined;
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = undefined; host = undefined; if (descriptor) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', descriptor); else delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight; });

function Panel({ pending, height, contentKey = 'a' }: { pending: boolean; height: number; contentKey?: string }) {
  const [ref, style] = useHeldHeight<HTMLDivElement>(contentKey);
  return <div ref={ref} style={style} data-h={height} data-panel>{pending ? <p data-query-state="pending">载入中</p> : <table><tbody><tr><td>rows</td></tr></tbody></table>}</div>;
}
const render = (pending: boolean, height: number, contentKey = 'a') => act(() => { root!.render(<Panel pending={pending} height={height} contentKey={contentKey} />); });
const panel = () => document.querySelector<HTMLDivElement>('[data-panel]')!;

test('换查询塌成一行时撑住上一次的高度，回执到达后放开；内容真的变短也放开', async () => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  // 锁的是 2026-09-22 的实机故障：切页签时面板塌成一行「载入中」，浏览器把滚动位置钳到新的最大值（scrollY 979 → 262）。
  await render(false, 2482, 'workloads'); expect(panel().style.minHeight).toBe('');
  // 内容键变了：同一次提交直接带上下限，不给别处的布局读取留下按塌掉高度钳滚动的机会。
  await render(true, 40, 'pods'); expect(panel().style.minHeight).toBe('2482px');
  await render(true, 40, 'pods'); expect(panel().style.minHeight).toBe('2482px');
  await render(false, 245, 'pods'); expect(panel().style.minHeight).toBe('');
  // 键没变而内容自己进入载入态：效应看到载入态再撑；键变了但内容已在（缓存命中）不撑。
  await render(true, 40, 'pods'); expect(panel().style.minHeight).toBe('245px');
  await render(false, 300, 'nodes'); expect(panel().style.minHeight).toBe('');
  // 首次载入没有「上一次」可撑。
  act(() => root!.unmount()); host!.remove(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await render(true, 40, 'pods'); expect(panel().style.minHeight).toBe('');
});

test('子组件自己进入载入态（父组件不重渲染）时靠 DOM 观察撑住并放开', async () => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await render(false, 1200);
  const marker = document.createElement('p'); marker.setAttribute('data-query-state', 'pending');
  await act(async () => { panel().setAttribute('data-h', '40'); panel().replaceChildren(marker); await new Promise((r) => setTimeout(r, 0)); });
  expect(panel().style.minHeight).toBe('1200px');
  await act(async () => { marker.remove(); panel().setAttribute('data-h', '900'); await new Promise((r) => setTimeout(r, 0)); });
  expect(panel().style.minHeight).toBe('');
});
