import { z } from 'zod';

export const RouteDomainSchema = z.enum(['user', 'service']);
export const RouteKindSchema = z.enum(['console', 'prod', 'preview', 'dev-preview', 'service', 'platform-api', 'internal-api', 'event-ingress', 'auth']);

/** 路由表：一条 Host（可带路径前缀）到一个 Kubernetes Service 端口。 */
export const RouteEntrySchema = z.object({
  host: z.string().min(1),
  pathPrefix: z.string().startsWith('/').optional(),
  domain: RouteDomainSchema,
  kind: RouteKindSchema,
  target: z.object({ namespace: z.string().min(1), service: z.string().min(1), port: z.number().int().min(1).max(65535) }),
  /** 网关中间件名（ForwardAuth 用户域、服务域放行、前缀剥离等）。 */
  middlewares: z.array(z.string().min(1)).default([]),
});

export const RouteTableSchema = z.object({
  version: z.number().int().min(0),
  generatedAt: z.iso.datetime(),
  routes: z.array(RouteEntrySchema),
});

export type RouteEntry = z.infer<typeof RouteEntrySchema>;
export type RouteTable = z.infer<typeof RouteTableSchema>;
export type RouteKind = z.infer<typeof RouteKindSchema>;
