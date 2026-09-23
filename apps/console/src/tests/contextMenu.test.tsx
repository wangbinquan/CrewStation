import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act, useState } from 'react';
import { messages } from '../app/i18n/zh-CN';
import { ContextMenu } from '../shared/ui/menu/ContextMenu';
import { renderElement } from './renderElement';

let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; });

/** 右键菜单的宿主：一个打开菜单的按钮，记录选了什么。 */
function Host({ picked }: { readonly picked: string[] }) {
  const [open, setOpen] = useState(false);
  return <div>
    <button type="button" onClick={() => setOpen(true)}>打开</button>
    <button type="button">别处</button>
    {open ? <ContextMenu label="标签操作" at={{ x: 40, y: 50 }} onClose={() => setOpen(false)} items={[
      { key: 'rename', label: '重命名', shortcut: 'F2', onSelect: () => picked.push('rename') },
      { key: 'maximize', label: '放大', disabled: true, hint: '只有一组时不需要放大', onSelect: () => picked.push('maximize') },
      { key: 'split', label: '向右分屏', onSelect: () => picked.push('split') },
      { key: 'stop', label: '结束进程', danger: true, separated: true, onSelect: () => picked.push('stop') },
    ]} /> : null}
  </div>;
}
const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const key = (target: Element, name: string) => act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })); });

test('打开时焦点在第一个可用项；上下键跳过不可用项循环移动，回车执行后关闭、焦点回到打开它的按钮', async () => {
  const picked: string[] = []; page = await renderElement(<Host picked={picked} />, messages);
  const opener = page.button('打开'); opener.focus(); await page.click('打开');
  expect(menu()?.getAttribute('aria-label')).toBe('标签操作'); expect(document.activeElement?.textContent).toBe('重命名F2');
  expect(menu()!.querySelector<HTMLButtonElement>('button[disabled]')?.title).toBe('只有一组时不需要放大');
  await key(menu()!, 'ArrowDown'); expect(document.activeElement?.textContent).toBe('向右分屏');
  await key(menu()!, 'ArrowDown'); expect(document.activeElement?.textContent).toBe('结束进程');
  await key(menu()!, 'ArrowDown'); expect(document.activeElement?.textContent).toBe('重命名F2');
  await key(menu()!, 'End'); expect(document.activeElement?.textContent).toBe('结束进程');
  await act(async () => (document.activeElement as HTMLButtonElement).click()); await page.settle();
  expect(picked).toEqual(['stop']); expect(menu()).toBeNull(); expect(document.activeElement).toBe(opener);
});

test('Escape、点菜单外面与窗口失焦都关闭且不执行任何项；不可用项点了也没用', async () => {
  const picked: string[] = []; page = await renderElement(<Host picked={picked} />, messages);
  await page.click('打开'); await key(menu()!, 'Escape'); expect(menu()).toBeNull();
  await page.click('打开'); await act(async () => { page!.button('别处').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); }); expect(menu()).toBeNull();
  await page.click('打开'); await act(async () => { window.dispatchEvent(new Event('blur')); }); expect(menu()).toBeNull();
  await page.click('打开'); await act(async () => menu()!.querySelector<HTMLButtonElement>('button[disabled]')!.click()); expect(menu()).not.toBeNull();
  expect(picked).toEqual([]);
});
