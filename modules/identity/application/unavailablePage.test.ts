import { expect, test } from 'bun:test';
import { renderUnavailablePage } from './unavailablePage';

const now = new Date('2026-09-23T12:00:00.000Z');

test('维护页：预计恢复时间已过时照常显示原时间并注明维护仍在进行；没有预计时间时如实说明', () => {
  const late = renderUnavailablePage({ entry: { kind: 'maintenance', projectSlug: 'demo', reason: '换库', expectedEndAt: '2026-09-23T10:00:00.000Z' }, consoleUrl: 'http://console.cs.localhost/', now });
  expect(late).toContain('2026-09-23 10:00 UTC');
  expect(late).toContain('已超过预计时间');
  const open = renderUnavailablePage({ entry: { kind: 'maintenance', projectSlug: 'demo', reason: '换库' }, consoleUrl: 'http://console.cs.localhost/', now });
  expect(open).toContain('负责人没有给出预计恢复时间');
  expect(open).not.toContain('已超过预计时间');
});

test('原因、项目名与返回地址都经 HTML 转义；四种下线原因各有说法', () => {
  const page = renderUnavailablePage({ entry: { kind: 'maintenance', projectSlug: 'x"y', reason: '<script>alert(1)</script>' }, consoleUrl: 'http://console.cs.localhost/?a="b"', now });
  expect(page).not.toContain('<script>alert(1)</script>');
  expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(page).toContain('x&quot;y');
  expect(page).toContain('href="http://console.cs.localhost/?a=&quot;b&quot;"');
  const reasons = { manual: '负责人手动下线', 'rollback-expired': '回退保留期已满', idle: '长期无人访问', cluster: '集群管理' } as const;
  for (const [reason, text] of Object.entries(reasons)) {
    expect(renderUnavailablePage({ entry: { kind: 'not-deployed', projectSlug: 'demo', offline: { at: '2026-09-23T01:00:00.000Z', reason: reason as keyof typeof reasons } }, consoleUrl: '/', now })).toContain(text);
  }
});
