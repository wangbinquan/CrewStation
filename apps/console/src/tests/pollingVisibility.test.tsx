import './domSetup';
import { expect, test } from 'bun:test';
import { act } from 'react';
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
