import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { browserHistoryFixture } from './browserHistoryFixture';
import { renderApp } from './renderApp';
import { clickSetting, editSetting, settingsButton, settingsField, settingsForm, visibilitySettingsFixture, visibilitySettingsRoute } from './visibilitySettingsFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

test('可见范围与展示资料共用一份离开确认；保存一张表单不会清除另一份草稿', async () => {
  const f = visibilitySettingsFixture(); page = await renderApp(visibilitySettingsRoute);
  await editSetting(page, '市场可见范围', 'authenticated'); await editSetting(page, '应用用途', '尚未保存的用途');
  // 旧页面切换设置分区直接卸载这两张表单，输入没有任何离开保护。
  await page.click('高级'); expect(page.search().tab).toBe('visibility');
  await page.click('成员与角色'); expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
  await clickSetting(page, '继续编辑'); expect(settingsField('应用用途').value).toBe('尚未保存的用途');
  await clickSetting(page, '保存可见范围'); expect(f.writes).toHaveLength(1);
  await page.click('高级'); expect(page.search().tab).toBe('visibility'); await clickSetting(page, '继续编辑');
  await clickSetting(page, '保存展示资料'); await page.click('高级'); expect(page.search().tab).toBe('advanced');
  expect(f.writes[1]!.input).toEqual({ description: '尚未保存的用途', icon: 'book', expectedRevision: 0 });
});

test('身份或任一设置读取失败都会暂停写入，保留两份输入；恢复读取不自动保存', async () => {
  const f = visibilitySettingsFixture(); page = await renderApp(visibilitySettingsRoute);
  await editSetting(page, '市场可见范围', 'authenticated'); await editSetting(page, '应用用途', '不能丢失的用途');
  for (const failure of ['app-visibility', 'app-presentation', 'me'] as const) {
    f.state.failure = failure; await clickSetting(page, '读取最新设置');
    expect(page.text()).toContain('最新设置暂不可读取');
    expect(settingsField('市场可见范围').value).toBe('authenticated'); expect(settingsField('应用用途').value).toBe('不能丢失的用途');
    // 旧表单只禁用保存中按钮，仍可按失败前的旧查询结果发出保存。
    if (failure === 'me') expect(settingsField('应用用途').closest('[hidden]')).not.toBeNull();
    else { expect(settingsButton('保存可见范围').disabled).toBe(true); expect(settingsButton('保存展示资料').disabled).toBe(true); }
    await act(async () => { for (const label of ['市场可见范围', '应用用途']) settingsForm(label).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await page.settle(); expect(f.writes).toHaveLength(0);
    f.state.failure = ''; await clickSetting(page, failure === 'me' ? '重新检查权限' : '读取最新设置');
    expect(settingsButton('保存可见范围').disabled).toBe(false); expect(settingsButton('保存展示资料').disabled).toBe(false);
  }
  expect(f.writes).toHaveLength(0); await clickSetting(page, '保存展示资料'); expect(f.writes).toHaveLength(1);
});

test('取消修改明确指向一张表单，取消确认保留输入，放弃不触碰另一张表单', async () => {
  const f = visibilitySettingsFixture(); page = await renderApp(visibilitySettingsRoute);
  await editSetting(page, '市场可见范围', 'authenticated'); await editSetting(page, '应用用途', '独立草稿');
  await clickSetting(page, '取消修改', settingsForm('市场可见范围'));
  expect(settingsField('市场可见范围').value).toBe('authenticated'); expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('市场可见范围');
  await clickSetting(page, '继续编辑'); await clickSetting(page, '取消修改', settingsForm('市场可见范围')); await clickSetting(page, '放弃这份修改');
  expect(document.querySelector('form select option[value="members"]')).toBeNull(); expect(page.text()).toContain('项目成员'); expect(settingsField('应用用途').value).toBe('独立草稿'); expect(f.writes).toHaveLength(0);
  await page.click('高级'); expect(page.search().tab).toBe('visibility'); await clickSetting(page, '继续编辑');
  await clickSetting(page, '取消修改', settingsForm('应用用途')); await clickSetting(page, '放弃这份修改');
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

test('负责人身份变化后保留可检查的草稿并停止保存，恢复后继续；初始只读用户不出现编辑入口', async () => {
  const f = visibilitySettingsFixture(); page = await renderApp(visibilitySettingsRoute);
  await editSetting(page, '应用用途', '角色变化前的草稿'); await editSetting(page, '市场可见范围', 'authenticated');
  f.state.role = 'developer'; f.state.visibility = { ...f.state.visibility, canConfigure: false }; await clickSetting(page, '读取最新设置');
  expect(settingsField('应用用途').value).toBe('角色变化前的草稿'); expect(settingsButton('保存展示资料').disabled).toBe(true); expect(settingsButton('保存可见范围').disabled).toBe(true);
  await page.click('高级'); expect(page.search().tab).toBe('visibility'); await clickSetting(page, '继续编辑');
  f.state.role = 'owner'; f.state.visibility = { ...f.state.visibility, canConfigure: true }; await clickSetting(page, '读取最新设置');
  await clickSetting(page, '保存展示资料'); expect(f.writes[0]!.input.description).toBe('角色变化前的草稿');
  page.unmount(); page = undefined; f.state.role = 'developer'; f.state.visibility = { ...f.state.visibility, canConfigure: false };
  page = await renderApp(visibilitySettingsRoute); expect(document.querySelector('textarea')).toBeNull(); expect(settingsButton('保存展示资料')).toBeUndefined();
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

test('应用设置首屏只显示摘要，两个编辑入口各自展开，干净取消立即收起', async () => {
  visibilitySettingsFixture(); page = await renderApp(visibilitySettingsRoute);
  expect(document.querySelector('form')).toBeNull(); expect(page.text()).toContain('整理团队知识');
  await clickSetting(page, '修改展示资料'); expect(document.querySelectorAll('form')).toHaveLength(1);
  expect(document.activeElement).toBe(settingsField('应用用途'));
  await clickSetting(page, '取消修改'); expect(document.querySelector('form')).toBeNull();
  await clickSetting(page, '修改可见范围'); expect(document.querySelectorAll('form')).toHaveLength(1);
  expect(document.activeElement).toBe(settingsField('市场可见范围'));
});
