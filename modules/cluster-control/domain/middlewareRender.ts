/** 限流中间件按什么分桶：请求头（网关注入的身份头）或主机（每个主机一只桶）。 */
export type MiddlewareKey = { readonly header: string } | { readonly host: true };

/**
 * 限流策略记录里调和器渲染 Traefik Middleware 要用的期望（RFC-025 设计 §7.3，gateway 写）：一个中间件要么是令牌桶（rateLimit），
 * 要么是同时在处理的请求数上限（inFlightReq）。记录是数据：字段不全或类型不对就不渲染，不猜。
 */
export interface MiddlewareRender {
  readonly namespace: string;
  readonly name: string;
  readonly rateLimit?: { readonly average: number; readonly burst: number; readonly key: MiddlewareKey };
  readonly inFlight?: { readonly amount: number; readonly key: MiddlewareKey };
}

type Fields = Readonly<Record<string, unknown>>;
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

function keyOf(value: unknown): MiddlewareKey | undefined {
  if (!isFields(value)) return undefined;
  if (text(value['header'])) return { header: value['header'] };
  return value['host'] === true ? { host: true } : undefined;
}

function renderOf(value: unknown): MiddlewareRender | undefined {
  if (!isFields(value) || !text(value['namespace']) || !text(value['name'])) return undefined;
  const rate = value['rateLimit'], flight = value['inFlight'];
  if (isFields(rate) && count(rate['average']) && count(rate['burst'])) {
    const key = keyOf(rate['key']);
    return key ? { namespace: value['namespace'], name: value['name'], rateLimit: { average: rate['average'], burst: rate['burst'], key } } : undefined;
  }
  if (isFields(flight) && count(flight['amount'])) {
    const key = keyOf(flight['key']);
    return key ? { namespace: value['namespace'], name: value['name'], inFlight: { amount: flight['amount'], key } } : undefined;
  }
  return undefined;
}

/** 从限流策略记录的期望取出每个中间件的渲染输入；有一个不合格就整条不渲染（返回 undefined）。 */
export function middlewareRendersOf(spec: { readonly [field: string]: unknown }): readonly MiddlewareRender[] | undefined {
  const list = spec['middlewares'];
  if (!Array.isArray(list)) return undefined;
  const renders = list.map(renderOf);
  return renders.every((entry) => entry !== undefined) ? renders as MiddlewareRender[] : undefined;
}
