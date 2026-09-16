import { expect, test } from 'bun:test';
import { renderForbiddenPage } from '../application/forbiddenPage';

test('用户域 403 页面：原因原话转义、返回工作台、双主题与工作台同源配色', () => {
  const page = renderForbiddenPage({ message: '没有项目 <demo> 的 preview 访问权限：需要项目成员或 preview 测试者', consoleUrl: 'http://console.cs.localhost/' });
  expect(page).toContain('没有项目 &lt;demo&gt; 的 preview 访问权限');
  expect(page).toContain('href="http://console.cs.localhost/"');
  expect(page).toContain('返回工作台');
  expect(page).toContain('color-scheme: light dark');
  for (const token of ['#f5f7fa', '#182438', '#235bd8', '#11151c', '#e7edf6']) expect(page).toContain(token);
  expect(page).not.toContain('<demo>');
});
