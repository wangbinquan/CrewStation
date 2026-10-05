import { GlobalRegistrator } from '@happy-dom/global-registrator';

/**
 * 渲染测试用的 DOM。必须在任何 react-dom 之前求值，所以单独成一个模块，
 * 测试文件把它写成第一条 import——ESM 按 import 顺序求值依赖。
 */
if (!('document' in globalThis)) {
  // 后端 HTTP／文件 I/O 与 DOM 用例共用进程，保留 Bun 的原生 Web 协议和取消信号。
  const nativeWeb = { Response: globalThis.Response, Request: globalThis.Request, Headers: globalThis.Headers, WebSocket: globalThis.WebSocket, fetch: globalThis.fetch,
    AbortController: globalThis.AbortController, AbortSignal: globalThis.AbortSignal };
  GlobalRegistrator.register();
  Object.assign(globalThis, nativeWeb);
}

// 捕获 DOM 注册后的实际后端传输；UI 用例随后临时替换 fetch 时不污染真实 HTTP 回归。
export const registeredBackendFetch = globalThis.fetch;

// React 的 act() 只在这个开关打开时才刷新更新队列，否则每次调用都警告且什么也不等。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
