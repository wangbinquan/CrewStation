/**
 * 由进来的请求拼出发给上游的请求（Design §8.1：proxy 内部是纯转发）。
 * 纯函数，不发网络请求：方法、路径、查询串与请求体原样带过去，只在请求头上做两件必要的事——
 * 剥掉不能转发的头，换上由平台按需注入的上游凭据。
 *
 * 路径约定：网关按 `/api/<proxy>/` 前缀路由并**剥掉该前缀**（modules/gateway/domain/routePlan.ts 的
 * `strip-api-<proxy>` 中间件），所以本服务看到的就是上游路径。GitLab 的 REST API 挂在 `/api` 下，
 * 因此 `/v4/projects` → `<上游>/api/v4/projects`，`openapi.yaml` 里的 `paths` 也按 `/v4/...` 写。
 */

/** GitLab 用它认令牌；平台注入的密钥放这里，绝不放进 URL、日志或响应。 */
export const UPSTREAM_TOKEN_HEADER = 'private-token';

/** 上游 REST API 的路径前缀。 */
export const UPSTREAM_API_PREFIX = '/api';

/** 平台 traceId：透传到上游，一条链路在两边都查得到。 */
export const TRACE_HEADER = 'x-cs-trace-id';

/**
 * 不往上游转发的请求头。
 * - 逐跳头由 fetch 自己管，转发过去只会打架；
 * - `host`／`content-length` 必须按新请求重算；
 * - 调用方自带的凭据头一律剥掉：凭据只能来自平台，不能由调用方指定（也防止它顶掉我们注入的令牌）；
 * - `x-cs-*` 是平台注入给本服务看的身份，公司系统不该看到——traceId 例外，见 TRACE_HEADER。
 */
const DROPPED_HEADERS = new Set([
  'host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authorization', 'proxy-authenticate', 'te', 'trailer',
  'authorization', 'private-token', 'job-token', 'cookie',
]);

const CS_HEADER_PREFIX = 'x-cs-';

export interface UpstreamPlan {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
}

export interface UpstreamPlanInput {
  /** 进来的请求 URL，例如 `http://reference-api-proxy.svc.cs.internal/v4/projects?per_page=5`。 */
  readonly requestUrl: string;
  readonly method: string;
  readonly headers: Headers;
  /** 上游地址，不含末尾斜杠。 */
  readonly upstreamBaseUrl: string;
  /** 平台注入的上游令牌；没有就不注入，由上游按匿名身份决定给什么。 */
  readonly upstreamToken?: string | null;
}

export function planUpstreamRequest(input: UpstreamPlanInput): UpstreamPlan {
  const incoming = new URL(input.requestUrl);
  return {
    url: `${input.upstreamBaseUrl}${UPSTREAM_API_PREFIX}${incoming.pathname}${incoming.search}`,
    method: input.method.toUpperCase(),
    headers: forwardedHeaders(input.headers, input.upstreamToken),
  };
}

export function forwardedHeaders(incoming: Headers, token?: string | null): Headers {
  const out = new Headers();
  for (const [name, value] of incoming) {
    const key = name.toLowerCase();
    if (DROPPED_HEADERS.has(key)) continue;
    if (key.startsWith(CS_HEADER_PREFIX) && key !== TRACE_HEADER) continue;
    out.set(name, value);
  }
  if (token) out.set(UPSTREAM_TOKEN_HEADER, token);
  return out;
}

/** GET／HEAD 没有请求体；其余方法把原始 body 原样带过去，不解析、不改写。 */
export function hasRequestBody(method: string): boolean {
  const upper = method.toUpperCase();
  return upper !== 'GET' && upper !== 'HEAD';
}
