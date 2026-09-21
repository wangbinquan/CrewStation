import './domSetup';
import { expect, test } from 'bun:test';
import { act } from 'react';
import { usePolledRefresh } from '../shared/lib/useManualRefresh';
import { usePollingRefetch } from '../shared/lib/usePollingRefetch';
import { renderElement } from './renderElement';

test('轮询在后台暂停、恢复前台补查；停用与卸载移除回调', async () => {
  let visible = true, reads = 0;
  const original = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible ? 'visible' : 'hidden' });
  const refetch = () => { reads += 1; };
  function View({ enabled = true }: { enabled?: boolean }) { usePollingRefetch(refetch, 10, enabled); return <p>轮询</p>; }
  const ui = await renderElement(<View />, {}); let unmounted = false;
  const visibility = async (value: boolean) => { visible = value; await act(async () => { document.dispatchEvent(new Event('visibilitychange')); }); };
  const interval = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
  try {
    await interval(); expect(reads).toBeGreaterThan(0); await visibility(false); const before = reads;
    await interval(); expect(reads).toBe(before);
    let immediatelyAfterReturn = 0;
    await act(async () => { visible = true; document.dispatchEvent(new Event('visibilitychange')); immediatelyAfterReturn = reads; }); expect(immediatelyAfterReturn).toBe(before + 1);
    ui.unmount(); unmounted = true; const stopped = reads; await visibility(false); await visibility(true); await interval(); expect(reads).toBe(stopped);
    const disabled = await renderElement(<View enabled={false} />, {});
    try { await visibility(false); await visibility(true); await interval(); expect(reads).toBe(stopped); } finally { disabled.unmount(); }
  } finally {
    if (!unmounted) ui.unmount(); if (original) Object.defineProperty(document, 'visibilityState', original); else Reflect.deleteProperty(document, 'visibilityState');
  }
});

test('例行轮询静默进行，只有手动刷新让界面进入重读状态', async () => {
  let reads = 0, release: (() => void) | undefined;
  const refetch = async () => { reads += 1; await new Promise<void>((resolve) => { release = resolve; }); };
  function View() {
    const { refresh, refreshing } = usePolledRefresh(refetch, 10);
    return <button disabled={refreshing} onClick={() => void refresh()}>{refreshing ? '更新中' : '刷新'}</button>;
  }
  const ui = await renderElement(<View />, {});
  const button = () => ui.host.querySelector('button')!;
  try {
    // 轮询已经在读，但按钮不变灰、文案不跳。
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
    expect(reads).toBeGreaterThan(0); expect(button().disabled).toBe(false); expect(button().textContent).toBe('刷新');
    await act(async () => { release?.(); });
    // 用户自己点的刷新照旧显示忙，读完恢复。
    await act(async () => { button().click(); });
    expect(button().disabled).toBe(true); expect(button().textContent).toBe('更新中');
    await act(async () => { release?.(); await Promise.resolve(); });
    expect(button().disabled).toBe(false); expect(button().textContent).toBe('刷新');
  } finally { ui.unmount(); release?.(); }
});
