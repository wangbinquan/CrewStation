import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act, useRef } from 'react';
import type { ReactElement } from 'react';
import { useTerminalFocus } from '../features/dev-session/hooks/native/useTerminalFocus';
import { renderElement } from './renderElement';

let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; setVisibility('visible'); });

function setVisibility(value: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
}

function Probe({ changes, enters }: { readonly changes: boolean[]; readonly enters: string[] }): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  useTerminalFocus(host, (active) => changes.push(active), () => enters.push('enter'));
  return <><div ref={host}><textarea aria-label="终端输入" /></div><button type="button">文件树</button></>;
}

const tick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });

// 「焦点在终端才保持」（2026-09-23 裁定）：只有焦点在终端里、页面可见时才算活动；点到别处、切走标签页都不再续约。
test('焦点进出终端与页面隐藏切换活动状态；进入时回调一次用于自动取得输入', async () => {
  const changes: boolean[] = [], enters: string[] = [];
  page = await renderElement(<Probe changes={changes} enters={enters} />, {});
  expect(changes).toEqual([]);
  await act(async () => page!.host.querySelector('textarea')!.focus());
  expect(changes).toEqual([true]); expect(enters).toEqual(['enter']);
  await act(async () => page!.host.querySelector('button')!.focus()); await tick();
  expect(changes).toEqual([true, false]);
  await act(async () => page!.host.querySelector('textarea')!.focus());
  expect(changes).toEqual([true, false, true]); expect(enters).toHaveLength(2);
  setVisibility('hidden');
  await act(async () => { document.dispatchEvent(new window.Event('visibilitychange')); });
  expect(changes.at(-1)).toBe(false);
  setVisibility('visible');
  await act(async () => { document.dispatchEvent(new window.Event('visibilitychange')); });
  expect(changes.at(-1)).toBe(true); expect(enters).toHaveLength(3);
});

test('卸载时若仍活动，按不活动收尾，停止续约', async () => {
  const changes: boolean[] = [], enters: string[] = [];
  page = await renderElement(<Probe changes={changes} enters={enters} />, {});
  await act(async () => page!.host.querySelector('textarea')!.focus());
  page.unmount(); page = undefined;
  expect(changes).toEqual([true, false]);
});
