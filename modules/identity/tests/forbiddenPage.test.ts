import { expect, test } from 'bun:test';
import { renderForbiddenPage, renderNoAppAccessPage } from '../application/forbiddenPage';

test('用户域 403 页面：原因原话转义、返回工作台、双主题与工作台同源配色', () => {
  const page = renderForbiddenPage({ message: '没有项目 <demo> 的 preview 访问权限：需要项目成员或 preview 测试者', consoleUrl: 'http://console.cs.localhost/' });
  expect(page).toContain('没有项目 &lt;demo&gt; 的 preview 访问权限');
  expect(page).toContain('href="http://console.cs.localhost/"');
  expect(page).toContain('返回工作台');
  expect(page).toContain('color-scheme: light dark');
  for (const token of ['#f5f7fa', '#182438', '#235bd8', '#11151c', '#e7edf6']) expect(page).toContain(token);
  expect(page).not.toContain('<demo>');
});

test('「没有项目权限」页：允许申请时给新开工作台申请页的「申请访问权限」与返回工作台；不允许时写负责人名字、没有申请入口（2026-09-24 裁定）', () => {
  const consoleUrl = 'http://console.cs.localhost/';
  const open = renderNoAppAccessPage({ appName: '周报<助手>', ownerName: '王五', applyUrl: 'http://console.cs.localhost/apps/p-1/access', consoleUrl });
  expect(open).toContain('<title>没有项目权限 · CrewStation</title>');
  expect(open).toContain('你没有应用「周报&lt;助手&gt;」的使用权限');
  expect(open).toContain('<a class="button primary" href="http://console.cs.localhost/apps/p-1/access" target="_blank" rel="noopener">申请访问权限</a>');
  expect(open).toContain(`href="${consoleUrl}">返回工作台</a>`);
  expect(open).toContain('批准后刷新本页即可');
  expect(open).not.toContain('请联系项目负责人');
  expect(open).not.toContain('<助手>');
  const closed = renderNoAppAccessPage({ appName: '周报助手', ownerName: '王<五>', consoleUrl });
  expect(closed).toContain('请联系项目负责人：<strong>王&lt;五&gt;</strong>');
  expect(closed).not.toContain('申请访问权限');
  expect(closed).toContain('返回工作台');
  for (const token of ['#f5f7fa', '#235bd8', '#11151c', 'color-scheme: light dark']) expect(closed).toContain(token);
});
