import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { adminAuthenticationFixture, provider } from './adminAuthenticationFixture';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

async function field(label: string, value: string): Promise<void> {
  const node = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select, textarea')]
    .find((element) => element.closest('label')?.textContent?.includes(label) || element.getAttribute('aria-label') === label);
  if (!node) throw new Error(`没有找到字段 ${label}`);
  await act(async () => {
    node.focus();
    const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  });
  await page!.settle();
}

test('认证页三张卡都在：登录方式、身份提供方与身份转发', async () => {
  adminAuthenticationFixture();
  page = await renderApp('/admin/authentication');
  const text = page.text();
  expect(text).toContain('登录方式');
  expect(text).toContain('身份提供方');
  expect(text).toContain('身份转发');
  expect(text).toContain('corp-sso');
  expect(text).toContain('已退役');
  expect(text).toContain('公司身份（OIDC）');
});

test('密码会话的管理员看不到关闭按钮，只看到为什么不能关', async () => {
  adminAuthenticationFixture({ authMethod: 'password' });
  page = await renderApp('/admin/authentication');
  expect(page.text()).toContain('请先用公司身份登录一次');
  // 文案里也有这几个字（卡片脚注），所以断的是「没有这个按钮」而不是「没有这段文本」。
  const buttons = [...document.querySelectorAll('button')].map((node) => node.textContent ?? '');
  expect(buttons).not.toContain('关闭用户名密码登录');
});

test('没有启用的提供方时同样不给关；安装配置强制开启时说明来源', async () => {
  adminAuthenticationFixture({ providers: [provider({ enabled: false })] });
  page = await renderApp('/admin/authentication');
  expect(page.text()).toContain('还没有启用的身份提供方');
  page.unmount();
  adminAuthenticationFixture({ forcedOn: true });
  page = await renderApp('/admin/authentication');
  expect(page.text()).toContain('CS_PASSWORD_LOGIN=force-on');
});

test('强制开启压着库内的「关」时：牌子写正在生效的状态，库内策略另起一行，两个方向都不给按', async () => {
  adminAuthenticationFixture({ forcedOn: true, passwordLoginEnabled: false });
  page = await renderApp('/admin/authentication');
  // 破窗开关正是唯一需要这块牌子的场合：照库内值写「已关闭」，而登录页明明还收密码，就是在骗人。
  expect(rowValue('用户名密码登录')).toBe('已开启');
  expect(rowValue('库内策略')).toBe('已关闭');
  const buttons = [...document.querySelectorAll('button')].map((node) => node.textContent ?? '');
  expect(buttons).not.toContain('开启用户名密码登录');
  expect(buttons).not.toContain('关闭用户名密码登录');
});

/** 取名值对列表里某一行的值；断「牌子上写的是什么」用。 */
function rowValue(label: string): string | undefined {
  const row = [...document.querySelectorAll('dt')].find((node) => node.textContent === label);
  return row?.nextElementSibling?.textContent ?? undefined;
}

test('OIDC 会话的管理员两段式确认后关闭常规登录，请求真的发出', async () => {
  const f = adminAuthenticationFixture();
  page = await renderApp('/admin/authentication');
  await page.click('关闭用户名密码登录');
  expect(page.text()).toContain('要恢复需要一位经公司身份登录的管理员');
  await page.click('确认关闭');
  const write = f.writes().find((c) => c.url.pathname === '/v1/admin/auth/login-policy');
  expect(write?.method).toBe('PUT');
  expect(write?.body).toEqual({ passwordLoginEnabled: false });
});

test('新增提供方：必填齐了才能提交，空值按 null 上线，自定义映射按等号解析', async () => {
  const f = adminAuthenticationFixture();
  page = await renderApp('/admin/authentication');
  await page.click('新增身份提供方');
  await field('标识', 'lab-sso');
  await field('显示名', '实验室身份');
  await field('Issuer 地址', 'https://lab.corp.example');
  await field('Client ID', 'cs-lab');
  await field('Client Secret', 'lab-secret');
  await field('自定义字段映射', 'employee-no=empNo');
  await page.click('新增');
  const created = f.writes().find((c) => c.method === 'POST');
  expect(created?.url.pathname).toBe('/v1/admin/auth/providers');
  expect(created?.body).toMatchObject({
    slug: 'lab-sso', displayName: '实验室身份', issuerUrl: 'https://lab.corp.example', clientId: 'cs-lab', clientSecret: 'lab-secret',
    authorizationEndpoint: null, tokenEndpoint: null, userinfoEndpoint: null, jwksUri: null, usernameClaim: null, subjectClaim: null,
    claimMappings: [{ key: 'employee-no', claim: 'empNo' }],
  });
});

test('测试连接把逐端点来源与 JWKS 可达性显示出来', async () => {
  adminAuthenticationFixture();
  page = await renderApp('/admin/authentication');
  await page.click('测试连接');
  const text = page.text();
  expect(text).toContain('可登录');
  expect(text).toContain('自动发现成功');
  expect(text).toContain('discovery https://idp.corp.example/authorize');
});

test('身份转发：默认转发显示名与邮箱，停止转发是两段式确认且只改那一个字段', async () => {
  const f = adminAuthenticationFixture();
  page = await renderApp('/admin/authentication');
  expect(page.text()).toContain('用户 ID 与身份令牌恒定转发');
  await page.click('停止转发');
  await page.click('确认');
  const write = f.writes().find((c) => c.url.pathname === '/v1/admin/auth/forwarding');
  expect(write?.method).toBe('PUT');
  expect((write?.body as { fields: string[] }).fields).toEqual(['email']);
});

test('项目覆盖：填项目与字段后保存，删除覆盖回到全局默认', async () => {
  const f = adminAuthenticationFixture();
  page = await renderApp('/admin/authentication');
  await field('项目', f.projectId);
  await field('转发字段', 'name');
  await page.click('保存项目覆盖');
  const saved = f.writes().find((c) => c.url.pathname.includes('/forwarding/projects/'));
  expect(saved?.method).toBe('PUT');
  expect(saved?.body).toEqual({ fields: ['name'] });
  await page.settle();
  expect(page.text()).toContain(f.projectId);
});


test('新增身份提供方一次标出所有必填错误，并允许取消；非法输入不发送请求', async () => {
  const f = adminAuthenticationFixture();
  page = await renderApp('/admin/authentication');
  await page.click('新增身份提供方'); await page.click('新增');
  expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(5);
  expect(document.activeElement?.getAttribute('aria-invalid')).toBe('true');
  expect(document.querySelector('input[type="password"]')).not.toBeNull();
  await field('标识', 'Wrong Slug');
  expect(document.activeElement?.closest('label')?.textContent).toContain('标识');
  await page.click('新增');
  expect(page.text()).toContain('1–64'); expect(f.writes()).toEqual([]);
  await page.click('取消编辑');
  expect(document.querySelector('input[type="password"]')).toBeNull();
  await page.click('新增身份提供方');
  expect(document.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('');
});
