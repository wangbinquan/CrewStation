import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { brandMarkDataUrl } from '../domain/brandMark';
import { renderBootstrapPage } from '../application/bootstrapPage';
import { renderLoginPage } from '../application/loginPages';

test('登录前图标不需要二次鉴权，favicon 与登录字标逐字节使用 console 的同一原稿', () => {
  const canonical = readFileSync(new URL('../../../apps/console/public/brand/crewstation-mark.svg', import.meta.url), 'utf8');
  expect(decodeURIComponent(brandMarkDataUrl.slice('data:image/svg+xml,'.length))).toBe(canonical);
  const discovery = { mode: 'ready' as const, passwordLoginEnabled: true, bootstrapTokenEnabled: false, providers: [], loginPath: '/auth/login', logoutPath: '/auth/logout', jwksPath: '/.well-known/jwks.json' };
  for (const page of [renderLoginPage({ discovery, returnTo: 'http://demo.cs.localhost/' }), renderBootstrapPage()]) {
    expect(page).toContain(`<link rel="icon" type="image/svg+xml" href="${brandMarkDataUrl}">`);
    expect(page).toContain(`<img src="${brandMarkDataUrl}" alt="" width="40" height="40">`);
  }
});

test('OAuth 登录入口是整块可识别的身份卡片，而不是只有文字的超链接', () => {
  const html = renderLoginPage({
    discovery: {
      mode: 'ready',
      passwordLoginEnabled: false,
      bootstrapTokenEnabled: false,
      providers: [{ slug: 'corp-sso', displayName: '公司统一身份' }],
      loginPath: '/auth/login',
      logoutPath: '/auth/logout',
      jwksPath: '/.well-known/jwks.json',
    },
    returnTo: 'http://console.cs.localhost/',
  });

  // 回归用户在真实登录页看到的“原始超链接”：入口需要同时提供图标、说明和明确动作。
  expect(html).toContain('class="provider-card"');
  expect(html).toContain('class="provider-card-mark"');
  expect(html).toContain('class="provider-card-copy"');
  expect(html).toContain('class="provider-card-action"');
  expect(html).toContain('使用公司身份继续');
  expect(html).toContain('aria-label="使用 公司统一身份 登录"');
});
