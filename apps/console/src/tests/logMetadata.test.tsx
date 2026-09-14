import './domSetup';
import { afterEach, describe, expect, test } from 'bun:test';
import { LogList } from '../features/logs/components/LogList';
import { messages } from '../features/logs/i18n/zh-CN';
import { renderElement } from './renderElement';

let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; });

describe('日志时间和级别的真实来源', () => {
  test('缺少时间且混合输出没有级别时如实展示未知，保留原始内容', async () => {
    page = await renderElement(<LogList follow={false} entries={[
      { source: 'migration', pod: 'migrate-failed', stream: 'combined', message: 'RFC003_MIGRATION_FAILURE' },
    ]} />, messages);
    // 实机 migration 的 console.error 曾被统一贴成 stdout / INFO，查询时间又伪装为发生时间。
    expect(page.text()).toContain('时间未知');
    expect(page.text()).toContain('LOG');
    expect(page.text()).not.toContain('INFO');
    expect(page.text()).toContain('RFC003_MIGRATION_FAILURE');
  });

  test('已有时间仍按本地格式显示，完整时间可查看；正文明确级别继续识别', async () => {
    const ts = '2026-09-14T13:59:54.295Z';
    page = await renderElement(<LogList follow={false} entries={[
      { ts, source: 'migration', stream: 'combined', message: 'ERROR migration stopped' },
    ]} />, messages);
    expect(page.text()).toContain(new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(ts)));
    expect(page.host.querySelector(`[title="${ts}"]`)).not.toBeNull();
    expect(page.text()).toContain('ERROR');
    expect(page.text()).not.toContain('时间未知');
  });

  test('兼容原有 stdout／stderr 记录，混合输出的显式 INFO 仍可识别', async () => {
    page = await renderElement(<LogList follow={false} entries={[
      { ts: '2026-09-14T13:59:54.295Z', source: 'build', stream: 'stderr', message: 'compiler warning' },
      { ts: '2026-09-14T13:59:54.295Z', source: 'build', stream: 'stdout', message: 'build started' },
      { ts: '2026-09-14T13:59:54.295Z', source: 'build', stream: 'combined', message: 'INFO finished' },
    ]} />, messages);
    expect([...page.host.querySelectorAll('.level')].map((node) => node.textContent)).toEqual(['WARN', 'INFO', 'INFO']);
  });
});
