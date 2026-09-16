import { expect, test } from 'bun:test';
import { renderDemoLoginPage } from '../adapters/provider/demoLoginPage';

test('演示登录页跟随系统明暗主题，配色与工作台令牌同源（RFC-003 UX-AT-51）', () => {
  const page = renderDemoLoginPage({ returnTo: 'http://console.cs.localhost/projects' });
  expect(page).toContain('color-scheme: light dark');
  expect(page).toContain('@media (prefers-color-scheme: dark)');
  // 与 apps/console/src/app/theme/tokens.css 一致：浅色页面底、文字、主操作；暗色页面底与文字。
  for (const token of ['#f5f7fa', '#182438', '#235bd8', '#11151c', '#e7edf6']) expect(page).toContain(token);
  // 键盘焦点轮廓与工作台同色，不依赖浏览器默认样式。
  expect(page).toContain(':focus-visible { outline: 2px solid #8db3ff');
  // 表单字段与 returnTo 未受影响。
  expect(page).toContain('name="username"');
  expect(page).toContain('value="http://console.cs.localhost/projects"');
});
