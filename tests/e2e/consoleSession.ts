import { readFileSync } from 'node:fs';
import type { Page } from './cdp';
import { Browser, DEFAULT_CDP_PORT } from './cdp';

/** 实机验收打的是本机 kind 集群上的网关；换环境用 CS_E2E_CONSOLE 覆盖。 */
export const CONSOLE_URL = process.env.CS_E2E_CONSOLE ?? 'http://console.cs.localhost';
const CDP_PORT = Number(process.env.CS_E2E_CDP_PORT ?? DEFAULT_CDP_PORT);

/**
 * 只判断「fetch 没抛异常」是不够的：本机若设了 HTTP_PROXY，目标关着时代理会替它回一个 503，
 * 于是探测把「连不上」读成「可用」。所以两处探测都要看回来的东西对不对。
 */
async function probe(url: string, accept: (response: Response) => Promise<boolean> | boolean, timeoutMs = 1500): Promise<boolean> {
  try {
    return await accept(await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }));
  } catch {
    return false;
  }
}

/** 网关活着：要么直接给页面，要么 302 去登录；5xx 说明中间有人替它答话。 */
const gatewayUp = (url: string) => probe(url, (response) => response.status < 500);

/** 调试浏览器活着：/json/version 必须真的给出 WebSocket 调试地址。 */
const browserUp = (url: string) =>
  probe(url, async (response) => {
    if (!response.ok) return false;
    const body = (await response.json()) as { webSocketDebuggerUrl?: unknown };
    return typeof body.webSocketDebuggerUrl === 'string';
  });

/**
 * 两个条件都满足才跑实机用例：网关能应答，且本机有一个开着调试端口的 Chrome。
 * 起浏览器这一步就是显式的「我要跑实机」，所以不再额外设开关；没起浏览器的机器上整套自动跳过。
 * 起法见 tests/e2e/README.md。
 */
export async function e2eAvailable(): Promise<boolean> {
  const [gateway, browser] = await Promise.all([
    gatewayUp(CONSOLE_URL),
    browserUp(`http://127.0.0.1:${CDP_PORT}/json/version`),
  ]);
  return gateway && browser;
}

export function connectBrowser(): Promise<Browser> {
  return Browser.connect(CDP_PORT);
}

/** 以 `username` 演示登录到一个全新上下文；返回的页面此后就是这个身份。 */
/**
 * 实机登录走产品路径：用户名＋密码（RFC-005 删除了演示登录）。
 * 口令按顺序取 `CS_E2E_PASSWORD`、`.local/admin.env`；两处都没有就让调用方看到明确的失败，
 * 而不是悄悄停在登录页上让后面的断言给出假结论。
 */
export async function signIn(browser: Browser, username: string, password?: string): Promise<Page> {
  const secret = password ?? e2ePassword();
  const page = await browser.newPage(await browser.newContext());
  await page.goto(`${CONSOLE_URL}/`);
  const onLogin = await page.eval<boolean>(`!!document.querySelector('form input[name="password"]')`);
  if (onLogin) {
    const loaded = page.waitForLoad();
    await page.eval(`(() => {
      const form = document.querySelector('form');
      form.querySelector('input[name="username"]').value = ${JSON.stringify(username)};
      form.querySelector('input[name="password"]').value = ${JSON.stringify(secret)};
      form.requestSubmit();
    })()`);
    await loaded;
  }
  await settle(page);
  return page;
}

/** 实机用的管理员用户名：安装脚本写在 .local/admin.env 里，可用 CS_E2E_USERNAME 覆盖。 */
export function e2eAdminUsername(): string {
  return process.env.CS_E2E_USERNAME ?? localAdminEnv('CS_BOOTSTRAP_ADMIN_USERNAME') ?? 'platform-admin';
}

/** 第二个非管理员身份：本机只能由 OIDC 或另一套口令提供，没配就让相关用例整组跳过。 */
export function e2eVisitor(): { username: string; password: string } | undefined {
  const username = process.env.CS_E2E_VISITOR_USERNAME;
  const password = process.env.CS_E2E_VISITOR_PASSWORD;
  return username && password ? { username, password } : undefined;
}

function localAdminEnv(key: string): string | undefined {
  try {
    const file = readFileSync(new URL('../../.local/admin.env', import.meta.url), 'utf8');
    return new RegExp(`^${key}=(.*)$`, 'm').exec(file)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function e2ePassword(): string {
  const password = process.env.CS_E2E_PASSWORD ?? localAdminEnv('CS_BOOTSTRAP_ADMIN_PASSWORD');
  if (password) return password;
  throw new Error('缺少实机登录口令：设置 CS_E2E_PASSWORD，或让 install-platform.sh 写出 .local/admin.env');
}

/** 等到页面不再处于载入态；工作台各页统一用这几个词表示还在读。 */
export async function settle(page: Page, timeoutMs = 15000): Promise<void> {
  await page.waitUntil(`!!document.querySelector('main h1, form')`, timeoutMs).catch(() => undefined);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const busy = await page.eval<boolean>(`/载入中|读取中|连接中/.test(document.querySelector('main')?.innerText ?? '')`).catch(() => false);
    if (!busy) break;
    await Bun.sleep(200);
  }
  await Bun.sleep(300);
}

/** 打开一条控制台路径并等它稳定。 */
export async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${CONSOLE_URL}${path}`);
  await settle(page);
}

/** 以当前身份问平台要数据；用来让用例自己发现环境里的真实对象，而不是写死 ID。 */
export function apiGet<T>(page: Page, path: string): Promise<T> {
  return page.eval<T>(`fetch(${JSON.stringify(path)}, { headers: { accept: 'application/json' } }).then((r) => r.json())`);
}
