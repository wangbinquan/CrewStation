import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { adminAuthenticationFixture, provider } from './adminAuthenticationFixture';
import { dialogConfirmButton, openDialog, typeConfirmWord } from './confirmDialogDriver';
import { clickIdentityField, identityField, setIdentityField as field, clickIdentitySelector } from './identityUiHelpers';
import { renderApp } from './renderApp';
import { providerDraft, providerRequest } from '../features/admin/model/providerDraft';
import { providerErrors } from '../features/admin/model/providerValidation';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function rejectWrites(message = '配置保存失败') {
  const base = globalThis.fetch;
  const state = { fail: true };
  globalThis.fetch = (async (input, init) => state.fail && init?.method && init.method !== 'GET'
    ? Response.json({ error: 'conflict', message }, { status: 409 }) : base(input, init)) as typeof fetch;
  return state;
}

test('认证标签可直达、键盘切换并返回；非法标签落在登录方式', async () => {
  adminAuthenticationFixture(); page = await renderApp('/admin/authentication?tab=bad');
  expect(page.search()).toEqual({ tab: 'methods' });
  const tab = document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!;
  await act(async () => { tab.focus(); tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); }); await page.settle();
  expect(page.search()).toEqual({ tab: 'fields' }); expect(page.text()).toContain('身份转发');
  expect(document.activeElement?.textContent).toBe('身份字段');
  await page.back(); expect(page.search()).toEqual({ tab: 'methods' });
});

test('编辑跨四组往返，无损保存账户、端点、名称拼接和映射；空密钥不提交', async () => {
  const f = adminAuthenticationFixture(); page = await renderApp('/admin/authentication'); await page.click('编辑');
  expect((identityField('标识') as HTMLInputElement).disabled).toBe(true);
  expect((identityField('Client Secret') as HTMLInputElement).value).toBe(''); expect(page.text()).toContain('密钥已设置');
  await field('显示名', '研发登录'); await clickIdentityField('启用');
  await page.click('连接设置');
  await field('授权端点', 'https://oauth.example/authorize'); await field('令牌端点', 'https://oauth.example/token');
  await field('userinfo 端点', 'https://oauth.example/user'); await field('JWKS 地址', 'https://oauth.example/jwks');
  await field('userinfo 请求风格', 'post_json');
  await page.click('账号规则'); await field('开通策略', 'auto'); await field('允许的邮箱域', '@a.example, @b.example'); await clickIdentityField('邮箱视为已验证');
  await page.click('字段映射'); await field('显示名字段', 'first_name last_name'); await field('Git 名字段', 'git_first git_last'); await field('邮箱字段', 'work_email'); await field('主体字段', 'employee_id');
  await page.click('添加映射'); await field('平台字段名 1', 'department'); await field('来源字段 1', 'deptName');
  await page.click('基本信息'); expect((identityField('显示名') as HTMLInputElement).value).toBe('研发登录');
  await page.click('保存修改'); const body = f.writes().at(-1)?.body;
  expect(body).toMatchObject({ displayName: '研发登录', enabled: false, userinfoRequestStyle: 'post_json', trustEmailVerified: true, provisioning: 'auto', allowedEmailDomains: ['@a.example', '@b.example'], usernameClaim: 'first_name last_name', gitNameClaim: 'git_first git_last', emailClaim: 'work_email', subjectClaim: 'employee_id', claimMappings: [{ key: 'department', claim: 'deptName' }], authorizationEndpoint: 'https://oauth.example/authorize', tokenEndpoint: 'https://oauth.example/token', userinfoEndpoint: 'https://oauth.example/user', jwksUri: 'https://oauth.example/jwks' });
  expect(body).not.toHaveProperty('clientSecret'); expect(document.querySelector('input[type="password"]')).toBeNull(); expect(page.text()).toContain('研发登录');
});

test('跨组错误集中计数，首错自动定位；隐藏字段不会因换组绕过校验', async () => {
  const f = adminAuthenticationFixture(); page = await renderApp('/admin/authentication'); await page.click('编辑');
  await page.click('连接设置'); await field('令牌端点', 'bad-url');
  await page.click('账号规则'); await field('允许的邮箱域', 'wrong-domain');
  await page.click('字段映射'); await field('显示名字段', '__proto__'); await page.click('添加映射');
  await field('平台字段名 1', 'Bad Key'); await field('来源字段 1', 'constructor');
  await page.click('保存修改');
  expect(page.text()).toContain('连接设置 · 1 项错误'); expect(page.text()).toContain('账号规则 · 1 项错误'); expect(page.text()).toContain('字段映射 · 3 项错误');
  expect(document.activeElement?.closest('label')?.textContent).toContain('令牌端点'); expect(f.writes()).toEqual([]);
  await page.click('字段映射'); expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(3);
  await page.click('删除'); expect(document.querySelectorAll('input')).toHaveLength(4);
});

test('保存失败保留草稿并能重试；取消只关窗、草稿留着，切换页面标签前要确认放弃', async () => {
  const f = adminAuthenticationFixture(), response = rejectWrites(); page = await renderApp('/admin/authentication'); await page.click('编辑');
  await field('显示名', '保留草稿'); await field('Client Secret', 'replacement-secret'); await page.click('保存修改');
  expect(page.text()).toContain('配置保存失败'); expect((identityField('显示名') as HTMLInputElement).value).toBe('保留草稿');
  // 2026-09-23 起编辑是弹窗：取消只关窗，草稿留着；同一页里切「登录方式」不丢，离开这一页才确认。
  await page.click('取消'); expect(document.querySelectorAll('dialog').length).toBe(0);
  await page.click('登录方式'); expect(page.text()).not.toContain('有未保存的输入');
  await page.click('身份字段'); expect(page.search()).toEqual({ tab: 'methods' }); expect(page.text()).toContain('公司统一身份有未保存的输入');
  await page.click('继续编辑'); await page.click('编辑'); expect((identityField('Client Secret') as HTMLInputElement).value).toBe('replacement-secret');
  response.fail = false; await page.click('保存修改');
  expect(f.writes().at(-1)?.body).toMatchObject({ clientSecret: 'replacement-secret' }); expect(document.querySelectorAll('dialog').length).toBe(0);
  await page.click('编辑'); await field('显示名', '丢弃'); await page.click('取消'); await page.click('身份字段'); await page.click('放弃输入并离开');
  expect(page.search()).toEqual({ tab: 'fields' }); expect(f.state.providers[0]?.displayName).toBe('保留草稿');
});

test('删除走弹窗、输入 delete 才发出 DELETE，保留后端拒绝原因', async () => {
  const f = adminAuthenticationFixture(), response = rejectWrites('仍有用户关联该提供方');
  page = await renderApp('/admin/authentication'); expect(page.text()).not.toContain('删除此接入方'); await page.click('编辑');
  await page.click('删除此接入方'); expect(openDialog().textContent).toContain('删除接入方「公司统一身份」（corp-sso）？');
  expect(openDialog().textContent).toContain('仍有用户关联着它时会被拒绝'); expect(dialogConfirmButton().disabled).toBe(true);
  await typeConfirmWord('删除'); expect(dialogConfirmButton().disabled).toBe(true); expect(f.writes()).toEqual([]);
  await typeConfirmWord('delete'); await page.click('确认删除');
  // 删除确认弹窗随请求结束关闭；编辑弹窗还在，拒绝原因显示在它里面（2026-09-23 起编辑是弹窗）。
  expect(document.querySelectorAll('dialog[open]').length).toBe(1); expect(openDialog().textContent).toContain('仍有用户关联该提供方');
  response.fail = false; await page.click('删除此接入方'); await typeConfirmWord('DELETE'); await page.click('确认删除');
  expect(f.writes().at(-1)?.method).toBe('DELETE'); expect(document.querySelectorAll('dialog').length).toBe(0); expect(page.text()).toContain('还没有身份提供方');
});

test('项目覆盖可保存空集合；失败不丢选择，恢复默认使用 DELETE', async () => {
  const f = adminAuthenticationFixture(), response = rejectWrites('项目配置冲突'); page = await renderApp('/admin/authentication?tab=fields');
  await page.click('添加项目规则'); await page.click('保存项目覆盖'); expect(document.activeElement?.tagName).toBe('SELECT');
  await field('项目', f.projectId); await clickIdentityField('显示名'); await clickIdentityField('邮箱');
  expect(page.text()).toContain('不传递可选身份字段'); await page.click('保存项目覆盖'); expect(page.text()).toContain('项目配置冲突');
  expect(document.querySelectorAll('input:checked')).toHaveLength(0); response.fail = false; await page.click('保存项目覆盖');
  expect(f.state.projectFields).toEqual([]); expect(f.writes().at(-1)?.body).toEqual({ fields: [] });
  await page.click('恢复全局默认'); await page.click('确认'); expect(f.state.projectFields).toBeUndefined(); expect(f.writes().at(-1)?.method).toBe('DELETE');
});

test('项目目录失败仍保留现有 ID 和过期字段；显式移除后才改变请求', async () => {
  const f = adminAuthenticationFixture(); f.state.projectFields = ['name', 'legacy-key'];
  const base = globalThis.fetch; let fail = true;
  globalThis.fetch = (async (input, init) => fail && new URL(String(input), 'http://localhost').pathname === '/v1/projects'
    ? Response.json({ error: 'unavailable', message: '项目目录不可用' }, { status: 503 }) : base(input, init)) as typeof fetch;
  page = await renderApp('/admin/authentication?tab=fields'); expect(page.text()).toContain(f.projectId); expect(page.text()).toContain('legacy-key');
  await page.click('编辑'); expect(page.text()).toContain('来源已不可用'); await page.click('保存项目覆盖');
  expect(f.writes().at(-1)?.body).toEqual({ fields: ['name', 'legacy-key'] });
  fail = false; await page.reread(); expect(page.text()).toContain('团队助理');
  await page.click('编辑'); await clickIdentityField('legacy-key'); await page.click('保存项目覆盖'); expect(f.writes().at(-1)?.body).toEqual({ fields: ['name'] });
});

// 2026-09-23 起项目规则在弹窗里：取消只关窗、草稿留着，再点恢复；清空回到空白；离开前确认，确认后才丢。
test('项目规则弹窗：取消保留草稿、清空重起、离开先确认；全局字段开启、停止失败和重试不影响其他字段', async () => {
  const f = adminAuthenticationFixture(); page = await renderApp('/admin/authentication?tab=fields');
  const dialogs = () => document.querySelectorAll('dialog[open]').length;
  await page.click('添加项目规则'); await field('项目', f.projectId); await page.click('取消'); expect(dialogs()).toBe(0);
  await page.click('添加项目规则'); expect(identityField('项目').value).toBe(f.projectId);
  await page.click('清空'); expect(dialogs()).toBe(1); expect(identityField('项目').value).toBe('');
  await field('项目', f.projectId); await page.click('取消');
  await page.requestNavigate('/admin/authentication?tab=methods'); expect(openDialog().textContent).toContain('按项目覆盖'); await page.click('继续编辑');
  expect(page.search()).toEqual({ tab: 'fields' }); expect(dialogs()).toBe(0);
  await page.requestNavigate('/admin/authentication?tab=methods'); await page.click('放弃输入并离开'); expect(page.search()).toEqual({ tab: 'methods' });
  await page.navigate('/admin/authentication?tab=fields'); await page.click('添加项目规则'); expect(identityField('项目').value).toBe(''); await page.click('取消');
  await page.click('开始转发'); expect(f.state.globalFields).toEqual(['name', 'email', 'git-name']);
  const response = rejectWrites('无法保存字段'); await page.click('停止转发'); await page.click('确认'); expect(page.text()).toContain('无法保存字段');
  response.fail = false; await page.click('停止转发'); await page.click('确认'); expect(f.state.globalFields).toEqual(['email', 'git-name']);
});

// 有草稿时去编辑另一条规则先确认：继续编辑回到原来那份，放弃才换。
test('编辑项目规则有未保存输入时去添加新规则先确认；继续编辑回到原草稿', async () => {
  const f = adminAuthenticationFixture(); f.state.projectFields = ['name']; page = await renderApp('/admin/authentication?tab=fields');
  await page.click('编辑'); expect(openDialog().textContent).toContain('编辑「团队助理」的项目规则');
  await clickIdentityField('邮箱'); await page.click('取消');
  await page.click('添加项目规则'); expect(openDialog().getAttribute('role')).toBe('alertdialog'); await page.click('继续编辑');
  expect(openDialog().textContent).toContain('编辑「团队助理」的项目规则'); expect((identityField('邮箱') as HTMLInputElement).checked).toBe(true);
  await page.click('取消'); await page.click('添加项目规则'); await page.click('放弃输入并离开');
  expect(openDialog().textContent).toContain('添加项目规则'); expect(f.writes()).toEqual([]);
});

test('完整提供方草稿往返保留所有隐藏字段；映射上限和长度复用契约约束', () => {
  const original = provider({ enabled: false, iconUrl: 'https://idp.example/icon.svg', userinfoRequestStyle: 'post_json', trustEmailVerified: true, provisioning: 'auto', claimMappings: [{ key: 'department', claim: 'dept' }] });
  const body = providerRequest(providerDraft(original));
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, clientSecretSet: _secretSet, ...expected } = original;
  expect<unknown>(body).toEqual(expected); expect(providerErrors(body, true)).toEqual({});
  expect(providerErrors(body, false)).toHaveProperty('clientSecret');
  expect(providerErrors({ ...body, claimMappings: Array.from({ length: 21 }, () => ({ key: 'k', claim: 'v' })) }, true)).toHaveProperty('claimMappings');
});

test('映射达到 20 行后不能再加，移除一行恢复添加', async () => {
  adminAuthenticationFixture({ providers: [provider({ claimMappings: Array.from({ length: 20 }, (_, i) => ({ key: `field-${i}`, claim: `claim${i}` })) })] });
  page = await renderApp('/admin/authentication'); await page.click('编辑'); await page.click('字段映射');
  expect([...document.querySelectorAll('button')].find((button) => button.textContent === '添加映射')?.disabled).toBe(true);
  await clickIdentitySelector('[aria-label="删除第 1 项映射"]');
  expect([...document.querySelectorAll('button')].find((button) => button.textContent === '添加映射')?.disabled).toBe(false);
});


test('超过 40 个或包含无效字段的旧规则明确提示，移除后保存；新增选择不覆盖已有项目规则', async () => {
  const f = adminAuthenticationFixture(); f.state.projectFields = Array.from({ length: 41 }, (_, i) => `field-${i}`);
  page = await renderApp('/admin/authentication?tab=fields'); await page.click('添加项目规则');
  expect(document.querySelector(`option[value="${f.projectId}"]`)).toBeNull(); await page.click('取消');
  await page.click('编辑'); expect(openDialog().textContent).toContain('编辑「团队助理」的项目规则'); await page.click('保存项目覆盖'); expect(page.text()).toContain('最多 40 个字段'); expect(f.writes()).toEqual([]);
  await clickIdentityField('field-40'); await page.click('保存项目覆盖'); expect(f.state.projectFields).toHaveLength(40);
  page.unmount(); f.state.projectFields = ['name', 'Invalid Key']; page = await renderApp('/admin/authentication?tab=fields');
  await page.click('编辑'); await page.click('保存项目覆盖'); expect(page.text()).toContain('无效字段'); expect(f.writes()).toHaveLength(1);
  await clickIdentityField('Invalid Key'); await page.click('保存项目覆盖'); expect(f.state.projectFields).toEqual(['name']);
});
