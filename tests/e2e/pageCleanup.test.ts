import { afterEach, expect, test } from 'bun:test';
import type { Browser, Page } from './cdp';
import { signIn } from './consoleSession';
import { openAdminSession } from './session';

/**
 * 锁的是 2026-09-23 的一次实机事故：没登成的页面不关，留在共用的调试浏览器里一直轮询。没有 .local 口令的导出树
 * 每跑一次门禁就留下 10 个登录页，几天累积上百个；cs-api 一重启它们一起涌入，连接池卡死、被探针反复重启。
 * 不需要集群：假浏览器记下开过、关过哪些页。
 */
const saved = { auth: process.env.CS_E2E_AUTH, password: process.env.CS_E2E_PASSWORD, require: process.env.CS_TEST_REQUIRE };
afterEach(() => {
  for (const [key, value] of [['CS_E2E_AUTH', saved.auth], ['CS_E2E_PASSWORD', saved.password], ['CS_TEST_REQUIRE', saved.require]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
function usePasswordLogin(require = ''): void {
  delete process.env.CS_E2E_AUTH;
  process.env.CS_E2E_PASSWORD = 'secret';
  process.env.CS_TEST_REQUIRE = require;
}

function fakeBrowser(evaluate: (expression: string) => Promise<unknown>, goto: () => Promise<void> = async () => {}) {
  const opened: string[] = [], closed: string[] = [], state = { socketClosed: false };
  const browser = {
    newContext: async () => 'context',
    newPage: async () => {
      const id = `page-${opened.length + 1}`;
      opened.push(id);
      return { targetId: id, sessionId: `session-${id}`, goto, eval: evaluate, waitUntil: async () => {}, waitForLoad: async () => {}, close: async () => { closed.push(id); } } as unknown as Page;
    },
    close: () => { state.socketClosed = true; },
  };
  return { browser: browser as unknown as Browser, opened, closed, state };
}

test('登录中途出错：关掉这次开的页面，再把错误抛给调用方', async () => {
  usePasswordLogin();
  const f = fakeBrowser(async () => false, async () => { throw new Error('navigation failed'); });
  await expect(signIn(f.browser, 'platform-admin')).rejects.toThrow('navigation failed');
  expect(f.opened).toEqual(['page-1']);
  expect(f.closed).toEqual(['page-1']);
});

test('登录成功：页面交给调用方，不关', async () => {
  usePasswordLogin();
  const f = fakeBrowser(async () => false);
  const page = await signIn(f.browser, 'platform-admin');
  expect(page.targetId).toBe('page-1');
  expect(f.closed).toEqual([]);
});

test('管理员会话：登录之后发现项目这一步失败，也关掉那一页并断开连接；没点名实机时整套跳过', async () => {
  usePasswordLogin();
  const f = fakeBrowser(async (expression) => (expression.startsWith('fetch(') ? Promise.reject(new Error('401')) : false));
  expect(await openAdminSession(async () => f.browser)).toBeUndefined();
  expect(f.closed).toEqual(['page-1']);
  expect(f.state.socketClosed).toBe(true);
});

test('点名实机（CS_TEST_REQUIRE=e2e）：照样关页，再把失败抛出来', async () => {
  usePasswordLogin('e2e');
  const f = fakeBrowser(async (expression) => (expression.startsWith('fetch(') ? Promise.reject(new Error('401')) : false));
  await expect(openAdminSession(async () => f.browser)).rejects.toThrow('管理员会话没有建立');
  expect(f.closed).toEqual(['page-1']);
});
