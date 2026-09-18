import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { brandMarkDataUrl } from '../domain/brandMark';
import { renderBootstrapPage, renderLoginPage } from '../application/loginPages';

test('登录前图标不需要二次鉴权，favicon 与登录字标逐字节使用 console 的同一原稿', () => {
  const canonical = readFileSync(new URL('../../../apps/console/public/brand/crewstation-mark.svg', import.meta.url), 'utf8');
  expect(decodeURIComponent(brandMarkDataUrl.slice('data:image/svg+xml,'.length))).toBe(canonical);
  const discovery = { mode: 'ready' as const, passwordLoginEnabled: true, bootstrapTokenEnabled: false, providers: [], loginPath: '/auth/login', logoutPath: '/auth/logout', jwksPath: '/.well-known/jwks.json' };
  for (const page of [renderLoginPage({ discovery, returnTo: 'http://demo.cs.localhost/' }), renderBootstrapPage()]) {
    expect(page).toContain(`<link rel="icon" type="image/svg+xml" href="${brandMarkDataUrl}">`);
    expect(page).toContain(`<img src="${brandMarkDataUrl}" alt="" width="40" height="40">`);
  }
});
