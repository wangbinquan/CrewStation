import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act, useState } from 'react';
import { messages } from '../app/i18n/zh-CN';
import { ConfirmDialog, matchesConfirmWord } from '../shared/ui/dialog/ConfirmDialog';
import { dialogConfirmButton, openDialog, typeConfirmWord } from './confirmDialogDriver';
import { renderElement } from './renderElement';

let rendered: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { rendered?.unmount(); rendered = undefined; });

interface ProbeProps { readonly busy?: boolean; readonly confirmDisabled?: boolean; readonly onConfirm?: () => void; readonly onOuterEscape?: () => void }

function Probe({ busy = false, confirmDisabled = false, onConfirm = () => {}, onOuterEscape = () => {} }: ProbeProps) {
  const [open, setOpen] = useState(false);
  return <div onKeyDown={(event) => { if (event.key === 'Escape') onOuterEscape(); }}>
    <button onClick={() => setOpen(true)}>归档项目</button>
    {open ? <ConfirmDialog title="归档项目" question="归档「演示数字人」（demo）？" confirmWord="archive" confirmLabel="确认归档" busy={busy} busyLabel="归档中…" confirmDisabled={confirmDisabled}
      onConfirm={onConfirm} onCancel={() => setOpen(false)}><ul><li>当前没有恢复归档的入口</li></ul></ConfirmDialog> : null}
  </div>;
}

async function open(props: ProbeProps = {}) {
  rendered = await renderElement(<Probe {...props} />, messages);
  const trigger = rendered.button('归档项目');
  trigger.focus();
  await act(async () => { trigger.click(); });
  await rendered.settle();
  return trigger;
}

test('确认词不分大小写、忽略首尾空格，别的词不算', () => {
  expect(matchesConfirmWord('archive', 'archive')).toBe(true);
  expect(matchesConfirmWord('  ARCHIVE ', 'archive')).toBe(true);
  expect(matchesConfirmWord('归档', 'archive')).toBe(false);
  expect(matchesConfirmWord('archiv', 'archive')).toBe(false);
  expect(matchesConfirmWord('delete', 'archive')).toBe(false);
  expect(matchesConfirmWord('', 'delete')).toBe(false);
});

test('以模态弹窗打开：标题、问句与后果都在弹窗里，焦点进输入框，输对确认词之前确认键不可点', async () => {
  let confirmed = 0;
  await open({ onConfirm: () => { confirmed += 1; } });
  const dialog = openDialog();
  expect(dialog.getAttribute('role')).toBe('alertdialog');
  expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('归档项目');
  expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe('归档「演示数字人」（demo）？');
  expect(dialog.textContent).toContain('当前没有恢复归档的入口');
  expect(dialog.textContent).toContain('输入 archive 以确认');
  expect(document.activeElement === dialog.querySelector('input')).toBe(true);
  const buttons = [...dialog.querySelectorAll('button')].map((node) => node.textContent);
  expect(buttons).toEqual(['确认归档', '取消']);
  expect(dialogConfirmButton().disabled).toBe(true);
  await typeConfirmWord('归档');
  expect(dialogConfirmButton().disabled).toBe(true);
  await typeConfirmWord(' Archive ');
  expect(dialogConfirmButton().disabled).toBe(false);
  await rendered!.click('确认归档');
  expect(confirmed).toBe(1);
});

test('回车只在确认词正确时提交', async () => {
  let confirmed = 0;
  await open({ onConfirm: () => { confirmed += 1; } });
  const form = openDialog().querySelector('form')!;
  await typeConfirmWord('archiv');
  await act(async () => { form.requestSubmit(); });
  expect(confirmed).toBe(0);
  await typeConfirmWord('archive');
  await act(async () => { form.requestSubmit(); });
  expect(confirmed).toBe(1);
});

test('取消与 Esc 关闭弹窗，焦点回到打开它的按钮；Esc 不冒泡到外层的键盘处理', async () => {
  let outer = 0;
  const trigger = await open({ onOuterEscape: () => { outer += 1; } });
  await rendered!.click('取消');
  expect(document.querySelectorAll('dialog').length).toBe(0);
  expect(document.activeElement === trigger).toBe(true);
  await act(async () => { trigger.click(); });
  await rendered!.settle();
  const dialog = openDialog();
  await act(async () => {
    dialog.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  await rendered!.settle();
  expect(outer).toBe(0);
  expect(document.querySelectorAll('dialog').length).toBe(0);
});

test('浏览器强行关掉弹窗时按取消处理，不留下看不见的弹窗', async () => {
  await open();
  await act(async () => { openDialog().close(); });
  await rendered!.settle();
  expect(document.querySelectorAll('dialog').length).toBe(0);
});

test('进行中：确认键显示进行中文案，输入、确认、取消与 Esc 都不可用', async () => {
  let confirmed = 0;
  await open({ busy: true, onConfirm: () => { confirmed += 1; } });
  const dialog = openDialog();
  expect(dialogConfirmButton().textContent).toBe('归档中…');
  expect(dialogConfirmButton().disabled).toBe(true);
  expect(dialog.querySelector('input')!.disabled).toBe(true);
  expect(rendered!.button('取消').disabled).toBe(true);
  await act(async () => { dialog.dispatchEvent(new Event('cancel', { cancelable: true })); });
  await act(async () => { dialog.querySelector('form')!.requestSubmit(); });
  expect(document.querySelectorAll('dialog[open]').length).toBe(1);
  expect(confirmed).toBe(0);
});

test('另有阻断时输对确认词也不能确认', async () => {
  let confirmed = 0;
  await open({ confirmDisabled: true, onConfirm: () => { confirmed += 1; } });
  await typeConfirmWord('archive');
  expect(dialogConfirmButton().disabled).toBe(true);
  await act(async () => { openDialog().querySelector('form')!.requestSubmit(); });
  expect(confirmed).toBe(0);
});
