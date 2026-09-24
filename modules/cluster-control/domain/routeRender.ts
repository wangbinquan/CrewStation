/**
 * 一条路由记录里调和器渲染 IngressRoute 要用的期望（RFC-025 第三期后半，gateway 写）：对象名与命名空间取自期望里的 IngressRoute 子对象。
 * 记录是数据：字段不全或类型不对就不渲染，不猜。
 */
export interface RouteRender {
  readonly namespace: string;
  readonly name: string;
  /** 所属服务名：渲染成 IngressRoute 的服务标签（与 gateway 直接建时一致）。 */
  readonly service: string;
  readonly host: string;
  readonly pathPrefix?: string;
  readonly priority?: number;
  readonly target: { readonly namespace: string; readonly service: string; readonly port: number };
  /** 中间件链（按顺序）；跨命名空间引用的带命名空间。 */
  readonly middlewares: readonly { readonly name: string; readonly namespace?: string }[];
  /** 待验证与正式主机（D13）：槽「已结束」时改指说明页用的中间件（同命名空间，调和器渲染）。 */
  readonly unavailable?: { readonly middleware: string };
}

type Fields = Readonly<Record<string, unknown>>;
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function middlewareOf(value: unknown): RouteRender['middlewares'][number] | undefined {
  if (!isFields(value) || !text(value['name'])) return undefined;
  if (value['namespace'] !== undefined && !text(value['namespace'])) return undefined;
  return { name: value['name'], ...(text(value['namespace']) ? { namespace: value['namespace'] } : {}) };
}

/** 从路由记录的期望取出渲染输入；缺字段或类型不对返回 undefined。 */
export function routeRenderOf(spec: { readonly children: readonly { readonly kind: string; readonly namespace?: string; readonly name: string }[]; readonly [field: string]: unknown }): RouteRender | undefined {
  const object = spec.children.find((child) => child.kind === 'IngressRoute');
  const { host, pathPrefix, priority, target, middlewares, service, unavailableMiddleware } = spec;
  if (!object?.namespace || !text(host) || !text(service) || !isFields(target) || !Array.isArray(middlewares)) return undefined;
  if (!text(target['namespace']) || !text(target['service']) || typeof target['port'] !== 'number') return undefined;
  if ((pathPrefix !== undefined && !text(pathPrefix)) || (priority !== undefined && typeof priority !== 'number') || (unavailableMiddleware !== undefined && !text(unavailableMiddleware))) return undefined;
  const chain = middlewares.map(middlewareOf);
  if (chain.some((entry) => entry === undefined)) return undefined;
  return {
    namespace: object.namespace, name: object.name, service, host, ...(text(pathPrefix) ? { pathPrefix } : {}), ...(typeof priority === 'number' ? { priority } : {}),
    target: { namespace: target['namespace'], service: target['service'], port: target['port'] }, middlewares: chain as RouteRender['middlewares'],
    ...(text(unavailableMiddleware) ? { unavailable: { middleware: unavailableMiddleware } } : {}),
  };
}
