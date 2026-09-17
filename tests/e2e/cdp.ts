/**
 * 最小 Chrome DevTools Protocol 驱动：一个浏览器，多个隔离上下文（各自独立 Cookie，即各自独立身份）。
 * 只做实机验收需要的动作，不追求通用浏览器库。
 */

type Json = Record<string, unknown>;

interface Pending {
  resolve: (value: Json) => void;
  reject: (error: Error) => void;
}

export class Browser {
  private ws!: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Set<(params: Json) => void>>();

  static async connect(port = DEFAULT_CDP_PORT): Promise<Browser> {
    const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
    const browser = new Browser();
    await browser.open(version.webSocketDebuggerUrl);
    return browser;
  }

  private open(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('cdp websocket error'));
      this.ws.onmessage = (event) => this.dispatch(JSON.parse(String(event.data)) as Json);
    });
  }

  private dispatch(message: Json): void {
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(String((message.error as Json).message)));
      else pending.resolve((message.result as Json) ?? {});
      return;
    }
    const key = `${String(message.sessionId ?? '')}:${String(message.method)}`;
    for (const listener of this.listeners.get(key) ?? []) listener((message.params as Json) ?? {});
  }

  send(method: string, params: Json = {}, sessionId?: string): Promise<Json> {
    const id = this.nextId++;
    const payload: Json = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise<Json>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  on(sessionId: string, method: string, listener: (params: Json) => void): () => void {
    const key = `${sessionId}:${method}`;
    const set = this.listeners.get(key) ?? new Set();
    set.add(listener);
    this.listeners.set(key, set);
    return () => set.delete(listener);
  }

  waitFor(sessionId: string, method: string, timeoutMs = 20000): Promise<Json> {
    return new Promise<Json>((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error(`timeout waiting for ${method}`)); }, timeoutMs);
      const off = this.on(sessionId, method, (params) => { clearTimeout(timer); off(); resolve(params); });
    });
  }

  /** 独立上下文 = 独立 Cookie 罐 = 独立登录身份。 */
  async newContext(): Promise<string> {
    return String(((await this.send('Target.createBrowserContext')) as { browserContextId: string }).browserContextId);
  }

  async newPage(browserContextId: string, width = 1440, height = 900): Promise<Page> {
    const { targetId } = (await this.send('Target.createTarget', { url: 'about:blank', browserContextId })) as { targetId: string };
    const { sessionId } = (await this.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string };
    const page = new Page(this, sessionId, targetId);
    await page.init(width, height);
    return page;
  }

  close(): void {
    this.ws.close();
  }
}

export class Page {
  private consoleErrors: string[] = [];

  constructor(private readonly browser: Browser, readonly sessionId: string, readonly targetId: string) {}

  async init(width: number, height: number): Promise<void> {
    await this.cmd('Page.enable');
    await this.cmd('Runtime.enable');
    this.browser.on(this.sessionId, 'Runtime.exceptionThrown', (params) => {
      const details = params.exceptionDetails as Json | undefined;
      this.consoleErrors.push(String((details?.exception as Json)?.description ?? details?.text ?? 'exception'));
    });
    this.browser.on(this.sessionId, 'Runtime.consoleAPICalled', (params) => {
      if (params.type !== 'error') return;
      this.consoleErrors.push(((params.args as Json[]) ?? []).map((arg) => String(arg.value ?? arg.description ?? '')).join(' '));
    });
    await this.cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  }

  cmd(method: string, params: Json = {}): Promise<Json> {
    return this.browser.send(method, params, this.sessionId);
  }

  /** 取出并清空本页累计的控制台错误；断言「这一步没有报错」用。 */
  takeErrors(): string[] {
    const out = [...this.consoleErrors];
    this.consoleErrors = [];
    return out;
  }

  async goto(url: string, timeoutMs = 20000): Promise<void> {
    const loaded = this.browser.waitFor(this.sessionId, 'Page.loadEventFired', timeoutMs);
    await this.cmd('Page.navigate', { url });
    await loaded;
  }

  async waitForLoad(timeoutMs = 20000): Promise<void> {
    await this.browser.waitFor(this.sessionId, 'Page.loadEventFired', timeoutMs);
  }

  async eval<T = unknown>(expression: string): Promise<T> {
    const result = (await this.cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })) as {
      result: { value: T };
      exceptionDetails?: Json;
    };
    if (result.exceptionDetails) throw new Error(`eval failed: ${JSON.stringify(result.exceptionDetails).slice(0, 300)}`);
    return result.result.value;
  }

  /** 轮询表达式直到为真；超时抛错并带上表达式，免得断言停在「什么都没发生」。 */
  async waitUntil(expression: string, timeoutMs = 15000, everyMs = 200): Promise<void> {
    const started = Date.now();
    for (;;) {
      if (await this.eval<boolean>(expression)) return;
      if (Date.now() - started > timeoutMs) throw new Error(`waitUntil timeout: ${expression.slice(0, 160)}`);
      await Bun.sleep(everyMs);
    }
  }

  url(): Promise<string> {
    return this.eval<string>('location.href');
  }

  /** 主内容区文本；断言「这一页渲染了什么」用。 */
  text(): Promise<string> {
    return this.eval<string>(`(document.querySelector('main')?.innerText ?? document.body.innerText).replace(/\\s+/g, ' ')`);
  }

  /** 整页文本，含顶栏与左栏；断言外壳上的入口用。 */
  bodyText(): Promise<string> {
    return this.eval<string>(`document.body.innerText.replace(/\\s+/g, ' ')`);
  }

  async close(): Promise<void> {
    await this.browser.send('Target.closeTarget', { targetId: this.targetId });
  }
}

export const DEFAULT_CDP_PORT = 9333;
