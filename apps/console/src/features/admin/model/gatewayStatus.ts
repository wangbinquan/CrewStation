import type { GatewayServiceRoutes } from '@crewstation/api-client';
import { RouteEntrySchema } from '@crewstation/contracts';

/** 网关页从放行表里读的全部内容：条目与默认开放操作只数个数。 */
export interface AllowlistFacts {
  readonly version: number;
  readonly entries: number;
  readonly defaultOpen: number;
  /** 尚未生成放行表时服务端不带这两项。 */
  readonly generatedAt: string | undefined;
  readonly maxStaleSeconds: number | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * 只检查页面要读的字段，条目内容不逐项校验：库里可能还留着旧版本生成的文档，
 * 而这一页正是用来发现漂移并「重算」的，不能因为一条旧格式条目就把整张卡片判成错误。
 * 形状不合返回 undefined，由调用方转成读取失败。
 */
export function readAllowlistFacts(body: unknown): AllowlistFacts | undefined {
  if (!isRecord(body) || typeof body.version !== 'number' || !Array.isArray(body.entries) || !Array.isArray(body.defaultOpen)) return undefined;
  const { generatedAt, maxStaleSeconds } = body;
  if (generatedAt !== undefined && typeof generatedAt !== 'string') return undefined;
  if (maxStaleSeconds !== undefined && typeof maxStaleSeconds !== 'number') return undefined;
  return { version: body.version, entries: body.entries.length, defaultOpen: body.defaultOpen.length, generatedAt, maxStaleSeconds };
}

/** 路由表每个字段都会画进表格，所以条目按契约解析；任何一条不合就整体判为不合，不悄悄丢行。 */
export function readServiceRoutes(body: unknown): GatewayServiceRoutes[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.items)) return undefined;
  const services: GatewayServiceRoutes[] = [];
  for (const item of body.items as readonly unknown[]) {
    if (!isRecord(item) || typeof item.serviceName !== 'string') return undefined;
    const routes = RouteEntrySchema.array().safeParse(item.routes);
    if (!routes.success) return undefined;
    services.push({ serviceName: item.serviceName, routes: routes.data });
  }
  return services;
}
