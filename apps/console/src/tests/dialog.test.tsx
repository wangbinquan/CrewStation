import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act, useState } from 'react';
import type { ReactNode } from 'react';
import { messages } from '../app/i18n/zh-CN';
import { Dialog } from '../shared/ui/dialog/Dialog';
import { DialogHost, DialogVisibility } from '../shared/ui/dialog/DialogHost';
import { FormDialog } from '../shared/ui/dialog/FormDialog';
import { ConfirmationDialog } from '../shared/ui/dialog/ConfirmationDialog';
import { ButtonSizeContext } from '../shared/ui/Button';
import { openDialog } from './confirmDialogDriver';
import { renderElement } from './renderElement';
import { consoleStyles, sourceAt } from './sourceScan';

// 2026-09-23 作者裁定：页内展开的表单与确认一律改弹窗，公共底座是 shared/ui/dialog。
// DOM 节点断言一律比较数量与布尔值：失败时 bun 序列化 happy-dom 节点会卡几十秒（dev-gotchas）。

let rendered: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { rendered?.unmount(); rendered = undefined; });

async function type(field: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const prototype = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  // happy-dom 下 React 走输入事件的兼容路径，要补一个 keyup 才读到新值。
  await act(async () => { field.focus(); Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
}

async function openWith(trigger: string): Promise<HTMLButtonElement> {
  const button = rendered!.button(trigger);
  button.focus();
  await act(async () => { button.click(); });
  await rendered!.settle();
  return button;
}

interface ProbeProps { readonly busy?: boolean; readonly onOuter?: (kind: string) => void; readonly children?: ReactNode }

/** 打开者放在一个有自己点击、按键与提交处理的外层里（React 的提交事件同样沿组件树冒泡）：弹窗里的事件不该传到它。 */
function Probe({ busy = false, onOuter = () => {}, children }: ProbeProps) {
  const [open, setOpen] = useState(false), [closed, setClosed] = useState(0), [submitted, setSubmitted] = useState(0);
  return <div onSubmit={(event) => { event.preventDefault(); onOuter('submit'); }} onClick={() => onOuter('click')} onKeyDown={() => onOuter('keydown')}>
    <button type="button" onClick={(event) => { event.stopPropagation(); setOpen(true); }}>进入维护</button>
    <span data-closed={closed} data-submitted={submitted} />
    {open ? <Dialog title="进入维护" busy={busy} onClose={() => { setOpen(false); setClosed((n) => n + 1); }} onSubmit={() => setSubmitted((n) => n + 1)}
      footer={<button type="submit">确认进入维护</button>}>
      {children ?? <label>维护原因<textarea name="reason" /></label>}
    </Dialog> : null}
  </div>;
}

const counts = () => { const span = rendered!.host.querySelector('span[data-closed]')!; return { closed: Number(span.getAttribute('data-closed')), submitted: Number(span.getAttribute('data-submitted')) }; };

test('以模态弹窗打开：标题、✕ 与正文都在弹窗里，焦点进第一个输入框；✕ 关闭后焦点回到打开它的按钮', async () => {
  rendered = await renderElement(<Probe />, messages);
  const trigger = await openWith('进入维护');
  const dialog = openDialog();
  expect(dialog.getAttribute('role')).toBe('dialog');
  expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('进入维护');
  expect(document.activeElement === dialog.querySelector('textarea')).toBe(true);
  const close = dialog.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!;
  expect(close.textContent).toBe('✕');
  await act(async () => { close.click(); });
  await rendered.settle();
  expect(document.querySelectorAll('dialog').length).toBe(0);
  expect(counts().closed).toBe(1);
  expect(document.activeElement === trigger).toBe(true);
});

test('Esc 关闭；进行中 ✕ 与 Esc 都不关；浏览器强行关掉时按关闭处理', async () => {
  rendered = await renderElement(<Probe />, messages);
  await openWith('进入维护');
  await act(async () => { openDialog().dispatchEvent(new Event('cancel', { cancelable: true })); });
  await rendered.settle();
  expect(document.querySelectorAll('dialog').length).toBe(0);
  rendered.unmount();
  rendered = await renderElement(<Probe busy />, messages);
  await openWith('进入维护');
  const dialog = openDialog();
  expect(dialog.getAttribute('aria-busy')).toBe('true');
  expect(dialog.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!.disabled).toBe(true);
  await act(async () => { dialog.dispatchEvent(new Event('cancel', { cancelable: true })); });
  await act(async () => { dialog.querySelector('form')!.requestSubmit(); });
  await rendered.settle();
  expect(document.querySelectorAll('dialog[open]').length).toBe(1);
  expect(counts()).toEqual({ closed: 0, submitted: 0 });
  await act(async () => { openDialog().close(); });
  await rendered.settle();
  expect(document.querySelectorAll('dialog').length).toBe(0);
  expect(counts().closed).toBe(1);
});

test('回车提交走弹窗自己的表单；弹窗里的点击、按键与提交不传到打开它的组件', async () => {
  const outer: string[] = [];
  rendered = await renderElement(<Probe onOuter={(kind) => outer.push(kind)} />, messages);
  await openWith('进入维护');
  const dialog = openDialog();
  await act(async () => {
    dialog.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
  });
  await rendered.settle();
  expect(counts().submitted).toBe(1);
  expect(outer).toEqual([]);
});

function HostedProbe({ hidden = false }: { readonly hidden?: boolean }) {
  const [open, setOpen] = useState(true);
  return <DialogHost>
    <form aria-label="外层表单">
      <div hidden={hidden}>
        {open ? <FormDialog title="新增变量" submitLabel="保存变量" onSubmit={() => {}} onClose={() => setOpen(false)}><label>变量名<input name="binding" /></label></FormDialog> : null}
      </div>
    </form>
  </DialogHost>;
}

test('有挂载点时弹窗渲染在应用根上：不嵌在打开它的表单里，也不在隐藏的面板里；首次渲染就是模态打开的', async () => {
  rendered = await renderElement(<HostedProbe hidden />, messages);
  const dialog = openDialog();
  expect(dialog.closest('[data-dialog-host]') !== null).toBe(true);
  expect(dialog.closest('form[aria-label="外层表单"]') === null).toBe(true);
  expect(dialog.closest('[hidden]') === null).toBe(true);
  // 弹窗自己的表单是唯一一层表单。
  expect(dialog.querySelectorAll('form').length).toBe(1);
  expect(document.activeElement === dialog.querySelector('input[name="binding"]')).toBe(true);
  await rendered.click('取消');
  expect(document.querySelectorAll('dialog').length).toBe(0);
});

interface DraftProbeProps { readonly error?: string; readonly busy?: boolean; readonly blocked?: boolean; readonly danger?: boolean }

/** 草稿在打开者手里：关窗保留，再打开恢复；「清空」回到初始值、弹窗不关（2026-09-23 裁定）。 */
function DraftProbe({ error, busy = false, blocked = false, danger = false }: DraftProbeProps) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(''), [saved, setSaved] = useState<string[]>([]);
  return <>
    <button onClick={() => setOpen(true)}>添加订阅</button>
    <p data-saved={saved.join('|')} />
    {open ? <FormDialog title="添加订阅" submitLabel="保存订阅" busyLabel="保存中…" busy={busy} submitDisabled={blocked} danger={danger} {...(error ? { error } : {})} dirty={draft !== ''}
      onClear={() => setDraft('')} onClose={() => setOpen(false)} onSubmit={() => { setSaved((all) => [...all, draft]); setDraft(''); setOpen(false); }}>
      <label>Webhook<input name="webhook" value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
    </FormDialog> : null}
  </>;
}

const field = () => openDialog().querySelector<HTMLInputElement>('input[name="webhook"]')!;
const labels = () => [...openDialog().querySelectorAll('button')].map((node) => node.getAttribute('aria-label') ?? node.textContent);

test('表单弹窗的操作条：提交在最左、取消其次、清空在最右；没改过时清空不可点', async () => {
  rendered = await renderElement(<DraftProbe />, messages);
  await openWith('添加订阅');
  expect(labels()).toEqual(['关闭', '保存订阅', '取消', '清空']);
  expect(rendered.button('保存订阅').type).toBe('submit');
  expect(rendered.button('清空').disabled).toBe(true);
  await type(field(), 'https://hooks.example/a');
  expect(rendered.button('清空').disabled).toBe(false);
});

test('取消只关窗、草稿留着，再打开恢复上次输入；清空回到初始值、弹窗不关，焦点回到第一个输入框', async () => {
  rendered = await renderElement(<DraftProbe />, messages);
  await openWith('添加订阅');
  await type(field(), 'https://hooks.example/a');
  await rendered.click('取消');
  expect(document.querySelectorAll('dialog').length).toBe(0);
  await openWith('添加订阅');
  expect(field().value).toBe('https://hooks.example/a');
  await rendered.click('清空');
  expect(document.querySelectorAll('dialog[open]').length).toBe(1);
  expect(field().value).toBe('');
  expect(document.activeElement === field()).toBe(true);
  await type(field(), 'https://hooks.example/b');
  await act(async () => { openDialog().querySelector('form')!.requestSubmit(); });
  await rendered.settle();
  expect(rendered.host.querySelector('p')!.getAttribute('data-saved')).toBe('https://hooks.example/b');
  expect(document.querySelectorAll('dialog').length).toBe(0);
});

test('表单弹窗：失败原因显示在操作条上方；提交键不可用时回车也不提交；进行中显示进行中文案并锁住按钮；危险提交红底', async () => {
  rendered = await renderElement(<DraftProbe error="维护状态已被他人修改" blocked />, messages);
  await openWith('添加订阅');
  const dialog = openDialog();
  expect(dialog.querySelector('[role="alert"]')?.textContent).toBe('维护状态已被他人修改');
  expect(rendered.button('保存订阅').disabled).toBe(true);
  await act(async () => { dialog.querySelector('form')!.requestSubmit(); });
  await rendered.settle();
  expect(rendered.host.querySelector('p')!.getAttribute('data-saved')).toBe('');
  rendered.unmount();
  rendered = await renderElement(<DraftProbe busy danger />, messages);
  await openWith('添加订阅');
  expect(rendered.button('保存中…').disabled).toBe(true);
  expect(rendered.button('保存中…').className.includes('dangerPrimary')).toBe(true);
  expect(rendered.button('取消').disabled).toBe(true);
});

interface ConfirmProbeProps { readonly title?: string; readonly hint?: string; readonly focus?: 'dialog' | 'cancel'; readonly confirmDisabled?: boolean; readonly children?: ReactNode }

function ConfirmProbe({ title, hint, focus, confirmDisabled = false, children }: ConfirmProbeProps) {
  const [open, setOpen] = useState(false), [result, setResult] = useState('');
  return <>
    <button onClick={() => setOpen(true)}>上线 v0.1.1</button>
    <p data-result={result} />
    {open ? <ConfirmationDialog question="正式版本 v0.1.0 → v0.1.1" confirmLabel="确认上线" cancelLabel="取消切换" confirmDisabled={confirmDisabled}
      {...(title ? { title } : {})} {...(hint ? { hint } : {})} {...(focus ? { focus } : {})}
      onConfirm={() => { setResult('confirmed'); setOpen(false); }} onCancel={() => { setResult('cancelled'); setOpen(false); }}>{children}</ConfirmationDialog> : null}
  </>;
}

const result = () => rendered!.host.querySelector('p')!.getAttribute('data-result');

test('确认弹窗：有标题时问句在正文并作说明；焦点在弹窗本身（先读问句，不会误按确认）；取消后焦点回到打开它的按钮', async () => {
  rendered = await renderElement(<ConfirmProbe title="上线 v0.1.1" hint="切换后正式域名的流量进入新版本。"><dl><dt>核对于</dt><dd>刚刚</dd></dl></ConfirmProbe>, messages);
  const trigger = await openWith('上线 v0.1.1');
  const dialog = openDialog();
  expect(dialog.getAttribute('role')).toBe('alertdialog');
  expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('上线 v0.1.1');
  expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe('正式版本 v0.1.0 → v0.1.1');
  expect(dialog.textContent).toContain('切换后正式域名的流量进入新版本。');
  expect(dialog.textContent).toContain('核对于');
  expect(document.activeElement === dialog).toBe(true);
  expect(labels()).toEqual(['关闭', '确认上线', '取消切换']);
  await rendered.click('取消切换');
  expect(result()).toBe('cancelled');
  expect(document.activeElement === trigger).toBe(true);
});

test('确认弹窗：没有标题时问句就是标题、不画空正文；可以默认聚焦取消；阻断时确认键不可点', async () => {
  rendered = await renderElement(<ConfirmProbe focus="cancel" confirmDisabled />, messages);
  await openWith('上线 v0.1.1');
  const dialog = openDialog();
  expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('正式版本 v0.1.0 → v0.1.1');
  expect(dialog.querySelectorAll('p').length).toBe(0);
  expect(document.activeElement === rendered.button('取消切换')).toBe(true);
  expect(rendered.button('确认上线').disabled).toBe(true);
  await act(async () => { dialog.dispatchEvent(new Event('cancel', { cancelable: true })); });
  await rendered.settle();
  expect(result()).toBe('cancelled');
});

function StackProbe() {
  const [form, setForm] = useState(false), [confirm, setConfirm] = useState(false);
  return <>
    <button onClick={() => setForm(true)}>添加成员</button>
    {form ? <FormDialog title="添加成员" submitLabel="添加" onSubmit={() => setConfirm(true)} onClose={() => setForm(false)}><label>账号<input name="account" /></label></FormDialog> : null}
    {confirm ? <ConfirmationDialog question="将负责人转移给访客？" confirmLabel="确认转移" onConfirm={() => { setConfirm(false); setForm(false); }} onCancel={() => setConfirm(false)} /> : null}
  </>;
}

test('弹窗之上再开确认弹窗：点击只落在最上层，取消后回到下面的表单弹窗', async () => {
  rendered = await renderElement(<StackProbe />, messages);
  await openWith('添加成员');
  await act(async () => { openDialog().querySelector('form')!.requestSubmit(); });
  await rendered.settle();
  expect(document.querySelectorAll('dialog[open]').length).toBe(2);
  // 最上层是确认弹窗：它的「取消」只关自己。
  await rendered.click('取消');
  expect(document.querySelectorAll('dialog[open]').length).toBe(1);
  expect(openDialog().textContent).toContain('添加成员');
  await rendered.click('取消');
  expect(document.querySelectorAll('dialog').length).toBe(0);
});

/** 守卫停用页面、页签后面的另一组：容器 hidden 但仍挂载；外层可以再包一层（任一层藏起就藏起）。 */
function VisibilityProbe() {
  const [hidden, setHidden] = useState(false);
  return <>
    <button type="button" data-toggle="" onClick={() => setHidden((value) => !value)}>切换</button>
    <DialogVisibility hidden={hidden}>
      <DialogVisibility hidden={false}><Dialog title="草稿" onClose={() => undefined}><input defaultValue="x" /></Dialog></DialogVisibility>
      <Dialog title="离开确认" persistent onClose={() => undefined}>{null}</Dialog>
    </DialogVisibility>
  </>;
}

// 弹窗经 portal 画在顶层，不随容器 hidden 藏起：由 DialogVisibility 告诉它此刻不画；离开确认（persistent）照样显示，导航在等它的回答。
test('所在的一片藏起时弹窗不画、重新显示时回来；离开确认照样显示', async () => {
  rendered = await renderElement(<VisibilityProbe />, messages);
  const titles = () => [...document.querySelectorAll('dialog[open] h2')].map((node) => node.textContent).join('、');
  const toggle = async () => { await act(async () => { rendered!.host.querySelector<HTMLButtonElement>('[data-toggle]')!.click(); }); await rendered!.settle(); };
  expect(titles()).toBe('草稿、离开确认');
  await toggle(); expect(titles()).toBe('离开确认'); expect(document.querySelectorAll('dialog').length).toBe(1);
  await toggle(); expect(titles()).toBe('草稿、离开确认');
});

// 开发页整片包在紧凑档里（ButtonSizeContext 沿组件树穿过 portal）：弹窗底部的按钮仍是标准档，✕ 是紧凑档。
test('紧凑档区域里打开的弹窗：操作条按钮仍是标准档', async () => {
  rendered = await renderElement(<ButtonSizeContext.Provider value="small"><FormDialog title="新建 Agent" submitLabel="启动" onSubmit={() => undefined} onClose={() => undefined}><input /></FormDialog></ButtonSizeContext.Provider>, messages);
  const classes = (label: string) => [...openDialog().querySelectorAll('button')].find((node) => node.textContent === label)!.className.split(' ');
  expect(classes('启动')).toEqual(['button', 'primary']); expect(classes('取消')).toEqual(['button', 'ghost']);
  expect(classes('✕')).toContain('small');
});

// 2026-09-23 实机：弹窗里 FormField 包着的「标记为 Secret」复选框被文字控件的 width: 100% 拉成整行宽、显示在正中。
test('FormField 只让文字类控件铺满整行，复选框与单选框靠左', () => {
  const css = sourceAt(consoleStyles(), 'shared/ui/FormField.module.css').code;
  expect(css).toContain('.field input:not([type="checkbox"]):not([type="radio"]),');
  expect(css).toMatch(/\.field input\[type="checkbox"\],\s*\.field input\[type="radio"\] \{\s*align-self: flex-start;/);
});
