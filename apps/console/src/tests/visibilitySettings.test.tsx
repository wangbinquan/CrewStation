import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { browserHistoryFixture } from './browserHistoryFixture';
import { renderApp } from './renderApp';
import { clickSetting, closeSetting, editSetting, openSetting, settingsButton, settingsField, settingsForm, settingsProjectId, visibilitySettingsFixture, visibilitySettingsRoute } from './visibilitySettingsFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

// 2026-09-23 起两张表单各是一个弹窗：关窗只收起、草稿留着；离开本页一次确认、写明是哪几份草稿；保存一份只清除自己的草稿。
test('可见范围与展示资料各一个弹窗：关窗草稿都留着，离开共用一次确认；保存一张不会清除另一份草稿', async () => {
  const f = visibilitySettingsFixture(); page = await renderApp(visibilitySettingsRoute);
  await editSetting(page, '市场可见范围', 'authenticated'); await editSetting(page, '应用用途', '尚未保存的用途'); await closeSetting(page);
  expect(document.querySelectorAll('dialog').length).toBe(0);
  await page.click('高级'); expect(page.search().tab).toBe('visibility'); expect(page.text()).toContain('应用展示资料、市场可见范围有未保存的输入');
  // 确认挂着时再发一次导航：只确认第一个目的地。
  await page.requestNavigate(`/projects/${settingsProjectId}/settings?tab=members`); expect(document.querySelectorAll('[role="alertdialog"]').length).toBe(1);
  await clickSetting(page, '继续编辑'); expect(page.search().tab).toBe('visibility');
  await openSetting(page, '修改展示资料'); expect(settingsField('应用用途').value).toBe('尚未保存的用途');
  await openSetting(page, '修改可见范围'); expect(settingsField('市场可见范围').value).toBe('authenticated');
  await clickSetting(page, '保存可见范围'); expect(f.writes).toHaveLength(1); expect(document.querySelectorAll('dialog').length).toBe(0);
  await page.click('高级'); expect(page.search().tab).toBe('visibility'); expect(page.text()).toContain('应用展示资料有未保存的输入'); await clickSetting(page, '继续编辑');
  await openSetting(page, '修改展示资料'); await clickSetting(page, '保存展示资料'); await page.click('高级'); expect(page.search().tab).toBe('advanced');
  expect(f.writes[1]!.input).toEqual({ description: '尚未保存的用途', icon: 'book', expectedRevision: 0 });
});

test('身份或任一设置读取失败都会暂停写入，两份草稿都留着、打开弹窗可查看；恢复读取不自动保存', async () => {
  const f = visibilitySettingsFixture(); page = await renderApp(visibilitySettingsRoute);
  await editSetting(page, '市场可见范围', 'authenticated'); await editSetting(page, '应用用途', '不能丢失的用途'); await closeSetting(page);
  for (const failure of ['app-visibility', 'app-presentation', 'me'] as const) {
    f.state.failure = failure; await page.reread();
    expect(page.text()).toContain('最新设置暂不可读取');
    // 身份读不到时整个设置区隐藏；其余情况弹窗照样能打开，草稿都在，保存暂停，提交也不发出。
    if (failure === 'me') expect(settingsButton('修改展示资料')).toBeUndefined();
    else {
      await openSetting(page, '修改可见范围'); expect(settingsField('市场可见范围').value).toBe('authenticated'); expect(settingsButton('保存可见范围').disabled).toBe(true);
      await act(async () => { settingsForm('市场可见范围').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await page.settle();
      await openSetting(page, '修改展示资料'); expect(settingsField('应用用途').value).toBe('不能丢失的用途'); expect(settingsButton('保存展示资料').disabled).toBe(true);
      await act(async () => { settingsForm('应用用途').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await page.settle();
      await closeSetting(page);
    }
    expect(f.writes).toHaveLength(0);
    f.state.failure = ''; await page.reread();
  }
  await openSetting(page, '修改展示资料'); expect(settingsButton('保存展示资料').disabled).toBe(false); expect(f.writes).toHaveLength(0);
  await clickSetting(page, '保存展示资料'); expect(f.writes).toHaveLength(1);
});

test('取消只收起所属弹窗、草稿留着；清空只把这一份回到已保存的值，不碰另一份草稿', async () => {
  const f = visibilitySettingsFixture(); page = await renderApp(visibilitySettingsRoute);
  await editSetting(page, '市场可见范围', 'authenticated'); await editSetting(page, '应用用途', '独立草稿');
  await clickSetting(page, '取消'); expect(document.querySelectorAll('dialog').length).toBe(0); expect(f.writes).toHaveLength(0);
  await openSetting(page, '修改可见范围'); expect(settingsField('市场可见范围').value).toBe('authenticated');
  await clickSetting(page, '清空'); expect(settingsField('市场可见范围').value).toBe('members'); expect(document.querySelectorAll('dialog[open]').length).toBe(1); await closeSetting(page);
  await openSetting(page, '修改展示资料'); expect(settingsField('应用用途').value).toBe('独立草稿');
  await clickSetting(page, '清空'); expect(settingsField('应用用途').value).toBe('整理团队知识'); await closeSetting(page);
  await page.click('高级'); expect(page.search().tab).toBe('advanced'); expect(f.writes).toHaveLength(0);
});

test('展示资料字段错误、保存失败与修订冲突均保留用途和图标，显式采用最新修订再提交', async () => {
  const f = visibilitySettingsFixture(); page = await renderApp(visibilitySettingsRoute);
  await editSetting(page, '应用用途', '长'.repeat(401)); await clickSetting(page, '保存展示资料');
  expect(settingsField('应用用途').getAttribute('aria-invalid')).toBe('true'); expect(document.activeElement === settingsField('应用用途')).toBe(true); expect(f.writes).toHaveLength(0);
  await editSetting(page, '应用用途', '本地说明'); await editSetting(page, '应用图标', 'chart');
  f.state.failWrite = true; await clickSetting(page, '保存展示资料'); expect(page.text()).toContain('设置保存失败'); expect(settingsField('应用图标').value).toBe('chart');
  f.state.failWrite = false; f.state.presentation = { ...f.state.presentation, description: '另一负责人说明', icon: 'spark', revision: 2 };
  await clickSetting(page, '保存展示资料'); expect(page.text()).toContain('另一负责人说明'); expect(settingsField('应用用途').value).toBe('本地说明');
  expect(settingsButton('保存展示资料').disabled).toBe(true);
  await clickSetting(page, '使用最新修订，保留本地草稿'); await clickSetting(page, '保存展示资料');
  expect(f.writes.at(-1)!.input).toEqual({ description: '本地说明', icon: 'chart', expectedRevision: 2 });
  await page.click('高级'); expect(page.search().tab).toBe('advanced');
});

test('保存中的重复 submit 只写一次；明确离开不会撤销请求，迟到成功不跳回', async () => {
  const f = visibilitySettingsFixture(); let finish!: () => void;
  f.state.hold = new Promise<void>((resolve) => { finish = resolve; });
  page = await renderApp(visibilitySettingsRoute); await editSetting(page, '应用用途', '待保存用途');
  const form = settingsForm('应用用途');
  await act(async () => { for (let i = 0; i < 2; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await page.settle();
  expect(f.writes).toHaveLength(1); expect(settingsField('应用用途').disabled).toBe(true); expect(page.text()).toContain('离开不会撤销已发送的保存请求');
  await page.requestNavigate('/projects'); expect(page.path()).toContain('/settings'); await clickSetting(page, '继续编辑'); expect(settingsField('应用用途').value).toBe('待保存用途');
  await page.requestNavigate('/projects'); await clickSetting(page, '放弃输入并离开');
  await act(async () => { finish(); }); await page.settle(); expect(page.path()).toBe('/projects'); expect(f.writes).toHaveLength(1);
});

test('负责人身份变化后草稿仍可打开检查、保存暂停，恢复后继续；初始只读用户不出现编辑入口', async () => {
  const f = visibilitySettingsFixture(); page = await renderApp(visibilitySettingsRoute);
  await editSetting(page, '应用用途', '角色变化前的草稿'); await editSetting(page, '市场可见范围', 'authenticated'); await closeSetting(page);
  f.state.role = 'developer'; f.state.visibility = { ...f.state.visibility, canConfigure: false }; await page.reread();
  await openSetting(page, '修改展示资料'); expect(settingsField('应用用途').value).toBe('角色变化前的草稿'); expect(settingsButton('保存展示资料').disabled).toBe(true);
  await openSetting(page, '修改可见范围'); expect(settingsButton('保存可见范围').disabled).toBe(true); await closeSetting(page);
  await page.click('高级'); expect(page.search().tab).toBe('visibility'); await clickSetting(page, '继续编辑');
  f.state.role = 'owner'; f.state.visibility = { ...f.state.visibility, canConfigure: true }; await page.reread();
  await openSetting(page, '修改展示资料'); await clickSetting(page, '保存展示资料'); expect(f.writes[0]!.input.description).toBe('角色变化前的草稿');
  page.unmount(); page = undefined; f.state.role = 'developer'; f.state.visibility = { ...f.state.visibility, canConfigure: false };
  page = await renderApp(visibilitySettingsRoute); expect(settingsButton('修改展示资料')).toBeUndefined(); expect(document.querySelectorAll('dialog').length).toBe(0);
});

test('返回浏览器历史前可保留草稿，确认离开后才导航；指定名单内部切换不丢查找输入', async () => {
  const f = visibilitySettingsFixture(), browser = browserHistoryFixture(['/projects', visibilitySettingsRoute]);
  page = await renderApp(visibilitySettingsRoute, undefined, browser.history);
  await editSetting(page, '市场可见范围', 'selected'); await editSetting(page, '完整邮箱或用户 ID', 'lin@example.com');
  await editSetting(page, '市场可见范围', 'authenticated'); await editSetting(page, '市场可见范围', 'selected');
  expect(settingsField('完整邮箱或用户 ID').value).toBe('lin@example.com');
  await page.back(); expect(page.path()).toContain('/settings'); await clickSetting(page, '继续编辑'); expect(settingsField('市场可见范围').value).toBe('selected');
  expect(browser.beforeUnload()).toBe(false); await page.back(); await clickSetting(page, '放弃输入并离开'); expect(page.path()).toBe('/projects'); expect(f.writes).toHaveLength(0);
});

test('应用展示只有展示资料与可见范围两张卡：「检查保存后的效果」已删除，页面上没有查找框，也不请求检查接口', async () => {
  visibilitySettingsFixture(); const paths: string[] = [], served = globalThis.fetch;
  globalThis.fetch = ((raw: Parameters<typeof fetch>[0], init?: RequestInit) => { paths.push(new URL(String(raw), 'http://localhost').pathname); return served(raw, init); }) as typeof fetch;
  page = await renderApp(visibilitySettingsRoute);
  // 2026-09-23 作者裁定删除这张卡与后端检查接口（RFC-009 proposal §3.4 同日再修订）。
  expect([...document.querySelectorAll('main section > header > h2')].map((node) => node.textContent)).toEqual(['应用展示资料', '市场可见范围']);
  expect(page.text()).not.toContain('检查保存后的效果'); expect(page.text()).not.toContain('查找账号'); expect(document.querySelector('form')).toBeNull();
  expect(paths.some((path) => path.includes('/app-visibility/check'))).toBe(false);
});

test('应用设置首屏只显示摘要，两个编辑入口各开一个弹窗，焦点进第一个输入，取消后回到入口', async () => {
  visibilitySettingsFixture(); page = await renderApp(visibilitySettingsRoute);
  expect(document.querySelector('form')).toBeNull(); expect(document.querySelectorAll('dialog').length).toBe(0); expect(page.text()).toContain('整理团队知识');
  await clickSetting(page, '修改展示资料'); expect(document.querySelectorAll('dialog[open]').length).toBe(1);
  expect(document.activeElement === settingsField('应用用途')).toBe(true);
  await clickSetting(page, '取消'); expect(document.querySelectorAll('dialog').length).toBe(0); expect(document.activeElement === settingsButton('修改展示资料')).toBe(true);
  await clickSetting(page, '修改可见范围'); expect(document.querySelectorAll('dialog[open]').length).toBe(1);
  expect(document.activeElement === settingsField('市场可见范围')).toBe(true);
});
