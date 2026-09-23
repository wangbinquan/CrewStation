import './domSetup';
import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test';
import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createQueryClient } from '../shared/api/queryClient';
import { useApiQuery } from '../shared/api/useApi';

// 定时重读的查询在后台暂停、回到前台补读（与 usePollingRefetch 同一规则）。2026-09-23 形态图实机：15 秒重读的页面
// 切走 18 秒再切回，又等了 10 秒才重读——全局 30 秒的新鲜期挡掉了补读。这里用生产的 QueryClient 配置，
// 拨系统时钟模拟「数据已经放了多久」，不真的等；定时器是真的，15 秒以上的周期在用例里不会自己触发。
// 切走／切回用 focusManager.setFocused（同 roleHome、rebuildSession），结束时回到前台，不改 document。

type PollOptions = { refetchIntervalMs?: number | ((data: number | undefined) => number | undefined); staleTimeMs?: number; refetchOnWindowFocus?: boolean };
const KEY = ['polling-probe'] as const;
let clock = Date.now();
const mounted: (() => void)[] = [];

beforeEach(() => { clock = Date.now(); setSystemTime(new Date(clock)); focusManager.setFocused(true); });
afterEach(() => { for (const unmount of mounted.splice(0)) unmount(); setSystemTime(); focusManager.setFocused(true); });

const flush = async () => { for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const passTime = (ms: number) => { clock += ms; setSystemTime(new Date(clock)); };
/** 切到别的标签页，过 ms 毫秒再切回来。 */
const awayAndBack = async (ms: number) => {
  await act(async () => { focusManager.setFocused(false); }); passTime(ms);
  await act(async () => { focusManager.setFocused(true); }); await flush();
};

async function mount(client: QueryClient, options: PollOptions): Promise<{ reads: () => number }> {
  let reads = 0;
  function View() { const query = useApiQuery(KEY, async () => { reads += 1; return reads; }, options); return <p>{query.data ?? '—'}</p>; }
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<QueryClientProvider client={client}><View /></QueryClientProvider>); });
  await flush();
  mounted.push(() => { act(() => root.unmount()); host.remove(); client.clear(); });
  return { reads: () => reads };
}

test('15 秒重读的查询切走 18 秒再切回立即补读；离上次读取不满一个周期时不补读，等下一次定时重读', async () => {
  const view = await mount(createQueryClient(), { refetchIntervalMs: 15_000 });
  expect(view.reads()).toBe(1);
  await awayAndBack(18_000);
  expect(view.reads()).toBe(2);
  await awayAndBack(5_000);
  expect(view.reads()).toBe(2);
});

test('进入页面时缓存旧过一个重读周期就立即重读，不满一个周期直接用缓存', async () => {
  const client = createQueryClient();
  client.setQueryData(KEY, 0);
  passTime(10_000);
  const fresh = await mount(client, { refetchIntervalMs: 15_000 });
  expect(fresh.reads()).toBe(0);
  for (const unmount of mounted.splice(0)) unmount();
  const reused = createQueryClient();
  reused.setQueryData(KEY, 0);
  passTime(20_000);
  const stale = await mount(reused, { refetchIntervalMs: 15_000 });
  expect(stale.reads()).toBe(1);
});

test('不例行重读的查询、显式关掉补读的查询与显式给了新鲜期的查询，切回都不补读', async () => {
  // 读到之后不再例行重读（如项目身份）：周期函数给 undefined，切回不补读。
  const once = await mount(createQueryClient(), { refetchIntervalMs: (data) => (data === undefined ? 30_000 : undefined) });
  await awayAndBack(40_000);
  expect(once.reads()).toBe(1);
  for (const unmount of mounted.splice(0)) unmount();
  const off = await mount(createQueryClient(), { refetchIntervalMs: 15_000, refetchOnWindowFocus: false });
  await awayAndBack(18_000);
  expect(off.reads()).toBe(1);
  for (const unmount of mounted.splice(0)) unmount();
  // 推送流保持最新的缓存（如资源台账视图）自己给无限新鲜期，不因切回而重读。
  const pushed = await mount(createQueryClient(), { refetchIntervalMs: 15_000, staleTimeMs: Number.POSITIVE_INFINITY });
  await awayAndBack(40_000);
  expect(pushed.reads()).toBe(1);
});
