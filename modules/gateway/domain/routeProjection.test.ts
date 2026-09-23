import { describe, expect, test } from 'bun:test';
import type { ProjectId, RouteEntry } from '@crewstation/contracts';
import { projectRoute, routeRef, SERVICE_ROUTE_KINDS } from './routeProjection';

const service = { serviceId: 'svc-1', projectId: '01a0bf5d-8f4b-7b10-9a12-5e7d8c4b3a66' as ProjectId, serviceName: 'demo', namespace: 'cs-demo' };
const target = { namespace: 'cs-demo', service: 'demo-blue', port: 80 };

describe('路由投影进资源台账（RFC-025 第三期后半）', () => {
  test('每条路由一条 route 记录：子对象是它的 IngressRoute，期望带 Host、前缀、目标与中间件，展示字段写种类、Host、前缀与目标；引用是 <服务>/<种类>，摘掉又出现的顺延 ~2、~3', () => {
    const routes: RouteEntry[] = [
      { host: 'demo.cs.localhost', domain: 'user', kind: 'prod', target, middlewares: ['drop', 'auth'] },
      { host: 'api.svc.cs.internal', pathPrefix: '/api/demo', domain: 'service', kind: 'internal-api', target, middlewares: ['drop', 'svc', 'strip-api-demo'] },
    ];
    expect(routes.map((route) => projectRoute(service, route, routeRef(service.serviceId, route.kind)))).toEqual([
      { kind: 'route', ref: 'svc-1/prod', projectId: service.projectId, spec: { children: [{ kind: 'IngressRoute', namespace: 'cs-demo', name: 'demo-prod' }], host: 'demo.cs.localhost', target, middlewares: ['drop', 'auth'] },
        display: { role: 'prod', host: 'demo.cs.localhost', target: 'cs-demo/demo-blue' } },
      { kind: 'route', ref: 'svc-1/internal-api', projectId: service.projectId, spec: { children: [{ kind: 'IngressRoute', namespace: 'cs-demo', name: 'demo-internal-api' }], host: 'api.svc.cs.internal', pathPrefix: '/api/demo', target, middlewares: ['drop', 'svc', 'strip-api-demo'] },
        display: { role: 'internal-api', host: 'api.svc.cs.internal', pathPrefix: '/api/demo', target: 'cs-demo/demo-blue' } },
    ]);
    expect(routeRef('svc-1', 'service')).toBe('svc-1/service');
    expect(routeRef('svc-1', 'internal-api', 2)).toBe('svc-1/internal-api~2');
    expect(projectRoute(service, routes[1]!, 'svc-1/internal-api~2').ref).toBe('svc-1/internal-api~2');
    expect(SERVICE_ROUTE_KINDS).toEqual(['prod', 'preview', 'service', 'internal-api']);
  });
});
