import { expect, test } from 'bun:test';
import { Browser, Page } from './cdp';

function fixture(navigate: () => Promise<Record<string, unknown>>, stop: () => Promise<Record<string, unknown>> = async () => ({})) {
  const listeners = new Map<string, (params: Record<string, unknown>) => void>();
  const commands: string[] = [];
  const browser = {
    on: (_session: string, event: string, listener: (params: Record<string, unknown>) => void) => { listeners.set(event, listener); return () => { listeners.delete(event); }; },
    send: async (method: string) => { commands.push(method); return method === 'Page.stopLoading' ? stop() : navigate(); },
    waitFor: Browser.prototype.waitFor,
  };
  return { page: new Page(browser as unknown as Browser, 'session', 'target'), listeners, commands,
    emit: (event: string) => listeners.get(event)?.({}) };
}

test('主文档已就绪时不等慢预览 iframe 的 load，导航结束清理监听', async () => {
  const f = fixture(async () => { f.emit('Page.domContentEventFired'); return { frameId: 'frame', loaderId: 'loader' }; });
  // 实机开发页的预览 iframe 持续加载；页面本身已能操作，不应等待子框架 load。
  await f.page.goto('http://test.localhost', 50);
  expect(f.listeners.size).toBe(0);
  expect(f.commands).toEqual(['Page.stopLoading', 'Page.navigate']);
});

test('同文档导航没有 loaderId 和 load 事件，也能完成', async () => {
  const f = fixture(async () => ({ frameId: 'frame' }));
  await f.page.goto('http://test.localhost/#details', 50);
  expect(f.listeners.size).toBe(0);
});

test('导航失败明确报原错误并清理事件和等待定时器', async () => {
  const f = fixture(async () => ({ frameId: 'frame', errorText: 'net::ERR_CONNECTION_REFUSED' }));
  await expect(f.page.goto('http://test.localhost', 50)).rejects.toThrow('net::ERR_CONNECTION_REFUSED');
  expect(f.listeners.size).toBe(0);
});

test('导航命令尚未回复也有总超时，不留下无主拒绝和事件监听', async () => {
  const f = fixture(() => new Promise(() => {}));
  await expect(f.page.goto('http://test.localhost', 20)).rejects.toThrow('navigation');
  expect(f.listeners.size).toBe(0);
});

test('停止旧加载超时后迟到回执不能再发起导航影响下一条用例', async () => {
  let release!: (value: Record<string, unknown>) => void;
  const f = fixture(async () => ({ frameId: 'frame' }), () => new Promise((resolve) => { release = resolve; }));
  await expect(f.page.goto('http://test.localhost', 20)).rejects.toThrow('navigation');
  release({}); await Promise.resolve(); await Promise.resolve();
  expect(f.commands).toEqual(['Page.stopLoading']);
  expect(f.listeners.size).toBe(0);
});
