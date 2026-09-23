import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act, useState } from 'react';
import { FULL_METRICS } from '../shared/ui/topology/topologyLayout';
import { TopologyList } from '../shared/ui/topology/TopologyList';
import { TopologyWorkspace } from '../shared/ui/topology/TopologyWorkspace';
import { renderElement } from './renderElement';
import { layoutFixture } from './topologyFixture';

// RFC-019 design §5：节点是可聚焦的 button，点选／键盘选中后压暗无关节点，筛选只压暗不移除，Esc 关闭详情，标签只在放得下时画。
let rendered: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { rendered?.unmount(); rendered = undefined; });
const nodeEl = (id: string) => document.querySelector<SVGGElement>(`[data-node-id="${id}"]`)!;
const dimmed = (id: string) => nodeEl(id).getAttribute('data-dim') === 'true';

function Harness({ laneGap }: { laneGap?: number }) {
  const [selected, setSelected] = useState<string>();
  return <><TopologyWorkspace topology={layoutFixture} label="夹具形态图" selectedId={selected} onSelect={setSelected} metrics={laneGap ? { ...FULL_METRICS, laneGap } : undefined}
    detail={selected ? <aside aria-label="详情">{selected}</aside> : undefined} /><output aria-label="选中">{selected ?? ''}</output></>;
}

test('nodes render as focusable buttons; click and Enter select; selection dims non-neighbours and Esc clears it', async () => {
  rendered = await renderElement(<Harness />, {});
  expect(document.querySelectorAll('[role="button"][data-node-id]')).toHaveLength(5);
  expect(document.querySelector('svg[role="group"]')?.getAttribute('aria-label')).toBe('夹具形态图');
  expect(nodeEl('route').getAttribute('tabindex')).toBe('0');
  await act(async () => { nodeEl('route').dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await rendered.settle();
  expect(nodeEl('route').getAttribute('aria-pressed')).toBe('true'); expect(document.querySelector('[aria-label="详情"]')?.textContent).toBe('route');
  expect(dimmed('deploy')).toBe(false); expect(dimmed('pod')).toBe(false); expect(dimmed('ws')).toBe(true); expect(dimmed('cli')).toBe(true);
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); }); await rendered.settle();
  expect(document.querySelector('[aria-label="详情"]')).toBeNull(); expect(dimmed('ws')).toBe(false);
  await act(async () => { nodeEl('cli').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }); await rendered.settle();
  expect(document.querySelector('[aria-label="选中"]')?.textContent).toBe('cli');
  expect(nodeEl('cli').getAttribute('aria-label')).toContain('cli，等待中');
});

test('filters dim without removing, the attention chip counts abnormal nodes, and the legend counts semantics, statuses and edge evidence', async () => {
  rendered = await renderElement(<Harness />, {});
  await rendered.click('开发会话');
  expect(dimmed('route')).toBe(true); expect(dimmed('ws')).toBe(false); expect(document.querySelectorAll('[data-node-id]')).toHaveLength(5);
  await rendered.click('清除筛选'); expect(dimmed('route')).toBe(false);
  await rendered.click('只看需要关注（1）'); expect(dimmed('ws')).toBe(true); expect(dimmed('cli')).toBe(false);
  const legend = document.querySelector('[aria-label="图例"]')!.textContent ?? '';
  for (const part of ['网关入口1', '服务槽2', '开发会话2', '等待中1', '运行中1', '就绪3', '实线为观测到的关系', '虚线为静态架构标注，不是实测']) expect(legend).toContain(part);
  expect(document.querySelectorAll('[data-evidence="static"]')).toHaveLength(2);
  // 快照完整时不占说明行：只有图框右上角的观测时间标签，说明放在悬停提示里。
  const stamp = [...document.querySelectorAll('span[title]')].find((n) => n.textContent?.startsWith('观测于'));
  expect(stamp?.getAttribute('title')).toContain('快照完整'); expect(stamp?.parentElement?.contains(document.querySelector('svg[role="group"]'))).toBe(true);
  // 2026-09-23 作者裁定：观测时间精确到秒（快照每 30 秒一换，到分钟时一半的更替看不出来）；悬停提示写实际节奏。
  expect(stamp?.textContent).toMatch(/^观测于 .+\d{1,2}:\d{2}:\d{2}$/); expect(stamp?.getAttribute('title')).toContain('集群快照每 30 秒采集一次，页面每 15 秒读取');
  expect(rendered.text()).not.toContain('快照完整');
});

// 2026-09-23 作者裁定：宽屏整块长满到窗口底边，详情在图的右侧自成一栏、各自滚动（集群管理与项目「部署与运行形态」共用）。
test('the workspace measures its height down to the window bottom and gives the detail its own column beside the diagram', async () => {
  rendered = await renderElement(<Harness />, {});
  const root = document.querySelector('svg[role="group"]')!.closest('.page') as HTMLElement;
  expect(root.style.getPropertyValue('--viewport-fill')).toMatch(/^\d+px$/);
  expect(document.querySelector('.workspace')!.className).toBe('workspace');
  await act(async () => { nodeEl('route').dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await rendered.settle();
  const detail = document.querySelector('[aria-label="详情"]')!.parentElement!;
  expect([detail.className, detail.parentElement!.className, detail.previousElementSibling!.className]).toEqual(['detail', 'workspace hasDetail', 'main']);
  expect(detail.previousElementSibling!.contains(document.querySelector('svg[role="group"]'))).toBe(true);
  // 详情栏自己滚：换选另一个节点时换一个栏，新详情从顶上看起。
  detail.scrollTop = 120;
  await act(async () => { nodeEl('cli').dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await rendered.settle();
  const next = document.querySelector('[aria-label="详情"]')!.parentElement!;
  expect(next.textContent).toBe('cli'); expect(next === detail).toBe(false); expect(next.scrollTop).toBe(0);
});

test('a partial snapshot still gets a warning line naming the failed sources', async () => {
  rendered = await renderElement(<TopologyWorkspace topology={{ ...layoutFixture, complete: false, incompleteReason: 'Pod（超时）' }} label="夹具形态图" onSelect={() => undefined} />, {});
  expect(rendered.text()).toContain('部分来源失败：Pod（超时）'); expect(rendered.text()).toContain('观测于');
});

test('edge labels are drawn only when the longest horizontal run has room for them', async () => {
  rendered = await renderElement(<Harness />, {});
  expect([...document.querySelectorAll('svg text')].some((n) => n.textContent === '线上流量')).toBe(false);
  rendered.unmount(); rendered = await renderElement(<Harness laneGap={160} />, {});
  expect([...document.querySelectorAll('svg text')].some((n) => n.textContent === '线上流量')).toBe(true);
});

test('the narrow-screen list keeps bands, semantics and status wording and toggles selection', async () => {
  let selected: string | undefined;
  rendered = await renderElement(<TopologyList topology={layoutFixture} selectedId="pod" onSelect={(id) => { selected = id; }} />, {});
  const rows = [...document.querySelectorAll('button[aria-pressed]')];
  expect(rows).toHaveLength(5); expect(rows.find((r) => r.textContent?.includes('pod'))?.getAttribute('aria-pressed')).toBe('true');
  expect(rendered.text()).toContain('线上槽 prod · blue'); expect(rendered.text()).toContain('开发会话'); expect(rendered.text()).toContain('等待中 ⚠');
  await act(async () => { (rows.find((r) => r.textContent?.includes('pod')) as HTMLButtonElement).click(); }); expect(selected).toBeUndefined();
  await act(async () => { (rows.find((r) => r.textContent?.includes('cli')) as HTMLButtonElement).click(); }); expect(selected).toBe('cli');
});
