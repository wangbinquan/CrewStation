import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { useState } from 'react';
import { act } from 'react';
import { ConfirmationPanel } from '../shared/ui/ConfirmationPanel';
import { messages } from '../app/i18n/zh-CN';
import { renderElement } from './renderElement';

let rendered: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { rendered?.unmount(); rendered = undefined; });

function Probe() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>检查上线</button>
    {open ? <ConfirmationPanel question="正式版本 v0.1.0 → v0.1.1" confirmLabel="确认上线" cancelLabel="取消切换" onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} /> : null}
  </>;
}

test('确认面板打开时焦点进入面板本身，取消后焦点回到打开它的按钮', async () => {
  rendered = await renderElement(<Probe />, messages);
  const trigger = rendered.button('检查上线');
  trigger.focus();
  expect(document.activeElement).toBe(trigger);
  await act(async () => { trigger.click(); });
  await rendered.settle();
  const panel = rendered.host.querySelector<HTMLElement>('[role="alertdialog"]');
  expect(panel).not.toBeNull();
  // 焦点在面板（先读问题），不是直接落在“确认上线”上。
  expect(document.activeElement).toBe(panel);
  expect(panel!.getAttribute('aria-label')).toBe('正式版本 v0.1.0 → v0.1.1');
  await rendered.click('取消切换');
  expect(rendered.host.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

function AsyncProbe() {
  const [phase, setPhase] = useState<'idle' | 'checking' | 'open'>('idle');
  const check = () => { setPhase('checking'); setTimeout(() => setPhase('open'), 5); };
  return <>
    <button disabled={phase === 'checking'} onClick={check}>{phase === 'checking' ? '正在核对' : '检查上线'}</button>
    {phase === 'open' ? <ConfirmationPanel question="正式版本 v0.1.0 → v0.1.1" confirmLabel="确认上线" cancelLabel="取消切换" onConfirm={() => setPhase('idle')} onCancel={() => setPhase('idle')} /> : null}
  </>;
}

test('打开按钮在异步预检期间被禁用而失焦：面板仍拿到焦点，取消后焦点回到重新可用的按钮', async () => {
  rendered = await renderElement(<AsyncProbe />, messages);
  const trigger = rendered.host.querySelector('button')!;
  // 真实浏览器里按钮在预检期间被禁用会失去焦点且不触发新的 focusin；这里用 focus→blur 模拟“曾经聚焦、现已失焦”。
  trigger.focus(); trigger.blur();
  expect(document.activeElement).not.toBe(trigger);
  await act(async () => { trigger.click(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); });
  await rendered.settle();
  const panel = rendered.host.querySelector<HTMLElement>('[role="alertdialog"]');
  expect(panel).not.toBeNull();
  expect(document.activeElement).toBe(panel);
  await rendered.click('取消切换');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  expect(rendered.host.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.disabled).toBe(false);
});
