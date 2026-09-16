import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { brandMarkDataUrl } from '../domain/brandMark';
import { renderDemoLoginPage } from '../adapters/provider/demoLoginPage';

test('登录前图标不需要二次鉴权，favicon 与登录字标逐字节使用 console 的同一原稿', () => {
  const canonical = readFileSync(new URL('../../../apps/console/public/brand/crewstation-mark.svg', import.meta.url), 'utf8');
  expect(decodeURIComponent(brandMarkDataUrl.slice('data:image/svg+xml,'.length))).toBe(canonical);
  const page = renderDemoLoginPage({ returnTo: 'http://demo.cs.localhost/' });
  expect(page).toContain(`<link rel="icon" type="image/svg+xml" href="${brandMarkDataUrl}">`);
  expect(page).toContain(`<img src="${brandMarkDataUrl}" alt="" width="40" height="40">`);
});
