import { profileIdOf } from './computeProfileFixture';
import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { PUSH_CREDENTIAL, computeBackend, profileDetail, profileTest, terminalProfile } from './computeProfileFixture';
import { dialogConfirmButton, openDialog, typeConfirmWord } from './confirmDialogDriver';
import { renderApp } from './renderApp';

let page: Awaited<ReturnType<typeof renderApp>> | undefined;
let backend: ReturnType<typeof computeBackend> | undefined;
afterEach(() => { page?.unmount(); page = undefined; backend?.restore(); backend = undefined; });

const failing = () => profileDetail({
  name: 'opencode-lite', protocol: 'opencode', description: '', model: undefined, taskProfile: '01a0bf5d-8f4b-74c3-80c6-46c408c84194', binaryPath: '/usr/local/bin/opencode', referencedBy: ['crm-bot', 'hr-helper'],
  availability: { state: 'test-failed', available: false, reason: '最近一次测试失败：缺少鉴权' },
  latestTest: profileTest({ profile: 'opencode-lite', revision: 3, state: 'failed', outcome: 'auth-missing' }),
  content: { launch: { protocol: 'opencode', binaryPath: '/usr/local/bin/opencode', extraArgs: [], isSandbox: false }, taskProfile: '01a0bf5d-8f4b-74c3-80c6-46c408c84194', configFile: { kind: 'none' }, steps: [], secrets: [] },
});
const paused = () => profileDetail({ name: 'claude-paused', enabled: false, availability: { state: 'disabled', available: false, reason: '已停用' } });

async function open(profiles = [profileDetail({ isDefault: true }), failing(), terminalProfile(), paused()]) {
  backend = computeBackend(profiles);
  page = await renderApp('/admin/compute');
}

const row = (name: string) => [...document.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('td code')?.textContent === name)! as HTMLTableRowElement;
const buttonIn = (scope: ParentNode, label: string) => [...scope.querySelectorAll('button')].find((button) => button.textContent === label);
async function clickIn(scope: ParentNode, label: string) {
  const target = buttonIn(scope, label);
  if (!target) throw new Error(`「${label}」不在：${(scope as HTMLElement).textContent}`);
  await act(async () => target.click()); await page!.settle();
}
async function actions(name: string) {
  const trigger = buttonIn(row(name), '更多操作')!;
  if (trigger.getAttribute('aria-expanded') !== 'true') await clickIn(row(name), '更多操作');
  return document.getElementById(trigger.getAttribute('aria-controls')!)!;
}
/** happy-dom 下 React 走 input 事件 polyfill：绕过值跟踪器写值，再以 keyup 触发 onChange。 */
async function type(input: HTMLInputElement, value: string) {
  await act(async () => { input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
  await page!.settle();
}

describe('算力档位列表（RFC-006）', () => {
  test('一张表就是全部：没有运行环境页签，四列保留关键状态，详细配置可以展开', async () => {
    await open();
    const text = page!.text();
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(text).not.toContain('运行环境');
    for (const header of ['档位', '执行配置', '状态', '操作']) expect([...document.querySelectorAll('th')].map((th) => th.textContent)).toContain(header);
    const claude = row('claude-daily').textContent!;
    for (const part of ['默认', 'Claude Code 协议', 'registry.cs.local/runtimes/claude:2.1', '@ab12cd34ef56', '/usr/local/bin/claude', 'anthropic/claude-sonnet-5', '平台默认任务套餐', '可用', '测试通过', '修订 1', '王管理']) expect(claude).toContain(part);
    const opencode = row('opencode-lite').textContent!;
    for (const part of ['OpenCode 协议', '二进制自带默认', 'cli-large', '测试失败', '最近一次测试失败：缺少鉴权', '缺少鉴权', '修订 3']) expect(opencode).toContain(part);
    const terminal = row('aider-shell').textContent!;
    for (const part of ['通用终端', '未测试', '尚未测试', '尚无测试']) expect(terminal).toContain(part);
    expect(terminal).not.toContain('二进制自带默认');
    expect(text).toContain('平台仓库与底座镜像'); expect(text).toContain('registry.cs.local:5443'); expect(text).toContain('COPY my-cli /opt/my-cli');
  });

  test('默认档位不能停用也不能删除；通用终端与已停用的档位不能设为默认——按钮禁用并写明原因', async () => {
    await open();
    const locked = '默认档位不能停用也不能删除，请先把默认改到别的档位。';
    const claude = await actions('claude-daily');
    expect(buttonIn(claude, '设为默认')).toBeUndefined();
    for (const label of ['停用', '删除']) { expect(buttonIn(claude, label)!.disabled).toBe(true); expect(buttonIn(claude, label)!.title).toBe(locked); }
    expect(claude.textContent).toContain(locked);
    const terminal = buttonIn(await actions('aider-shell'), '设为默认')!;
    expect(terminal.disabled).toBe(true); expect(terminal.title).toBe('通用终端档位不能设为默认：default 会被业务子任务引用。');
    const disabled = buttonIn(await actions('claude-paused'), '设为默认')!;
    expect(disabled.disabled).toBe(true); expect(disabled.title).toBe('已停用的档位不能设为默认，请先启用。');
    expect(buttonIn(await actions('claude-paused'), '启用')!.disabled).toBe(false);
    expect(buttonIn(await actions('opencode-lite'), '设为默认')!.disabled).toBe(false);
    expect(backend!.writes).toEqual([]);
  });

  test('删除被上线版本引用的档位：弹窗输入 delete，第一次 409 列出项目，再在弹窗里确认一次才带 confirmReferences 删除', async () => {
    await open();
    await clickIn(await actions('opencode-lite'), '删除');
    expect(openDialog().textContent).toContain('删除档位 opencode-lite？'); expect(openDialog().textContent).toContain('删除后不能恢复');
    expect(dialogConfirmButton().disabled).toBe(true); expect(backend!.writes).toEqual([]);
    await typeConfirmWord('delete'); await clickIn(openDialog(), '确认删除');
    expect(backend!.writes).toEqual([{ method: 'DELETE', path: `/v1/admin/compute-profiles/${profileIdOf('opencode-lite')}`, query: '', body: {} }]);
    expect(document.querySelectorAll('dialog').length).toBe(0);
    expect((await actions('opencode-lite')).textContent).toContain('这些项目的授权或当前上线版本引用了这个档位：crm-bot、hr-helper');
    await clickIn(await actions('opencode-lite'), '仍然删除');
    // 弹窗里仍列着引用的项目；请求发出后错误清空，这份清单不能跟着消失。
    expect(openDialog().textContent).toContain('确认删除 opencode-lite？2 个项目会受影响。'); expect(openDialog().textContent).toContain('crm-bot、hr-helper');
    expect(dialogConfirmButton().disabled).toBe(true);
    await typeConfirmWord('delete'); await clickIn(openDialog(), '仍然删除');
    expect(backend!.writes[1]).toMatchObject({ method: 'DELETE', query: '?confirmReferences=true' });
    expect(row('opencode-lite')).toBeUndefined();
  });

  test('设为默认、停用都先确认再请求，成功后整表刷新', async () => {
    await open();
    await clickIn(await actions('opencode-lite'), '设为默认');
    expect((await actions('opencode-lite')).textContent).toContain('把 opencode-lite 设为默认档位？');
    await clickIn(await actions('opencode-lite'), '确认');
    expect(backend!.writes[0]).toMatchObject({ method: 'PUT', path: `/v1/admin/compute-profiles/${profileIdOf('opencode-lite')}/default` });
    expect(row('opencode-lite').textContent).toContain('默认');
    expect(buttonIn(await actions('claude-daily'), '设为默认')!.disabled).toBe(false);
    await clickIn(await actions('claude-daily'), '停用'); await clickIn(await actions('claude-daily'), '确认');
    expect(backend!.writes[1]).toEqual({ method: 'PUT', path: `/v1/admin/compute-profiles/${profileIdOf('claude-daily')}/enabled`, query: '', body: { enabled: false } });
    expect(buttonIn(await actions('claude-daily'), '启用')).toBeDefined();
  });
});

describe('复制档位与推送凭据（RFC-006）', () => {
  test('复制：新名称先过长度校验，成功后直接打开副本的编辑页', async () => {
    await open();
    await clickIn(await actions('claude-daily'), '复制');
    // 2026-09-23 起新名称在弹窗里填。
    expect(openDialog().textContent).toContain('复制档位「claude-daily」');
    const name = openDialog().querySelector<HTMLInputElement>('input')!;
    expect(name.value).toBe('claude-daily-copy');
    await type(name, 'x'.repeat(81));
    expect(openDialog().textContent).toContain('名称需为 1–80 个字符。');
    expect(buttonIn(openDialog(), '复制为新档位')!.disabled).toBe(true);
    await type(openDialog().querySelector<HTMLInputElement>('input')!, 'claude-weekly');
    await clickIn(openDialog(), '复制为新档位');
    expect(document.querySelectorAll('dialog[open]').length).toBe(0);
    expect(backend!.writes).toEqual([{ method: 'POST', path: `/v1/admin/compute-profiles/${profileIdOf('claude-daily')}/copy`, query: '', body: { name: 'claude-weekly' } }]);
    expect(page!.search()).toEqual({ profile: backend!.state.profiles.find((p) => p.name === 'claude-weekly')!.id });
    expect(page!.text()).toContain('claude-weekly');
    expect([...document.querySelectorAll('label')].some((label) => label.querySelector('span')?.textContent === '档位名')).toBe(true);
  });

  test('推送凭据只显示一次：用户名、口令、登录命令可复制；收起后不再可见', async () => {
    const copied: string[] = [], original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied.push(text); } } });
    try {
      await open();
      await page!.click('签发推送凭据');
      expect(backend!.writes).toEqual([{ method: 'POST', path: '/v1/admin/runtime-images/credentials', query: '', body: {} }]);
      const text = page!.text();
      for (const part of [PUSH_CREDENTIAL.username, PUSH_CREDENTIAL.password, 'docker login registry.cs.local:5443 -u push-7f3a --password-stdin', 'runtimes/, crewstation/task', '口令只在这里显示一次']) expect(text).toContain(part);
      const copyPassword = document.querySelector<HTMLButtonElement>('button[aria-label="复制口令"]')!;
      await act(async () => copyPassword.click()); await page!.settle();
      expect(copied).toEqual([PUSH_CREDENTIAL.password]); expect(copyPassword.textContent).toBe('已复制');
      // 卡片在列表与编辑页的同一位置：打开编辑页不会让刚签发的一次性凭据消失。
      await clickIn(row('claude-daily'), '编辑');
      expect(page!.search()).toEqual({ profile: profileIdOf('claude-daily') }); expect(page!.text()).toContain(PUSH_CREDENTIAL.password);
      await page!.click('收起凭据');
      expect(page!.text()).not.toContain(PUSH_CREDENTIAL.password);
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original); else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  test('剪贴板不可用时如实提示复制失败', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } });
    try {
      await open([profileDetail({ isDefault: true })]);
      await page!.click('签发推送凭据');
      const copyLogin = document.querySelector<HTMLButtonElement>('button[aria-label="复制登录命令"]')!;
      await act(async () => copyLogin.click()); await page!.settle();
      expect(copyLogin.textContent).toBe('复制失败，请手动选择');
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original); else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
});

test('更多操作独立占整行；复制弹窗关窗与收起都保留草稿、清空回到默认名，Escape 返回触发按钮并撤销待确认操作', async () => {
  await open();
  const target = row('opencode-lite'), trigger = buttonIn(target, '更多操作')!;
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(buttonIn(target, '复制')).toBeUndefined();
  const panel = await actions('opencode-lite');
  // 曾把展开内容与编辑按钮放在同一个 flex 行里，编辑被拉伸、确认和复制表单挤在窄操作列。
  expect(panel.closest('tr')).not.toBe(target);
  expect(panel.closest('td')?.colSpan).toBe(4);
  expect(panel.getAttribute('aria-label')).toContain('opencode-lite');
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  // 表格行里的动作是紧凑档（2026-09-23 按钮统一）；删除红字红框。
  for (const label of ['编辑', '更多操作']) expect(buttonIn(target, label)!.className.split(' ')).toContain('small');
  for (const label of ['复制', '设为默认', '停用', '删除']) expect(buttonIn(panel, label)!.className.split(' ')).toContain('small');
  expect(buttonIn(panel, '删除')!.className.split(' ')).toContain('danger');
  await clickIn(panel, '复制');
  await type(openDialog().querySelector<HTMLInputElement>('input')!, 'my-profile-copy');
  await clickIn(openDialog(), '取消');
  expect(document.querySelectorAll('dialog').length).toBe(0);
  await clickIn(target, '更多操作');
  expect(document.getElementById(trigger.getAttribute('aria-controls')!)).toBeNull();
  const reopened = await actions('opencode-lite');
  await clickIn(reopened, '复制');
  expect(openDialog().querySelector<HTMLInputElement>('input')!.value).toBe('my-profile-copy');
  await clickIn(openDialog(), '清空');
  expect(openDialog().querySelector<HTMLInputElement>('input')!.value).toBe('opencode-lite-copy');
  await clickIn(openDialog(), '取消');
  // 鼠标点按钮会先让它获得焦点；程序化 click 不会，所以先聚焦再点。
  const remove = buttonIn(reopened, '删除')!; remove.focus(); await act(async () => remove.click()); await page!.settle();
  // 弹窗里的 Esc 只关弹窗，不连带收起操作面板；焦点回到「删除」。
  const dialog = openDialog();
  await act(async () => { dialog.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); dialog.dispatchEvent(new Event('cancel', { cancelable: true })); });
  await page!.settle();
  expect(document.querySelectorAll('dialog').length).toBe(0);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement === remove).toBe(true);
  await act(async () => reopened.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
  expect(backend!.writes).toEqual([]);
});


test('档位可按名称和模型搜索；无匹配可以清除，查询不修改档位', async () => {
  await open();
  await type(document.querySelector<HTMLInputElement>('input[type="search"]')!, 'OPENCODE');
  expect(row('opencode-lite')).toBeDefined(); expect(row('claude-daily')).toBeUndefined();
  await type(document.querySelector<HTMLInputElement>('input[type="search"]')!, 'no-profile');
  expect(page!.text()).toContain('没有匹配的档位');
  await page!.click('清除搜索'); expect(row('claude-daily')).toBeDefined();
  const details = row('claude-daily').querySelector('details')!;
  await act(async () => details.querySelector('summary')!.click());
  expect(details.open).toBe(true); expect(details.textContent).toContain('/usr/local/bin/claude');
  expect(backend!.writes).toEqual([]);
});
