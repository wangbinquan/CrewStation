import { describe, expect, test } from 'bun:test';
import type { ProjectId, RouteEntry } from '@crewstation/contracts';
import { PREFIX_ROUTE_PRIORITY, projectRoute, routeRef, SERVICE_ROUTE_KINDS } from './routeProjection';

const service = { serviceId: 'svc-1', projectId: '01a0bf5d-8f4b-7b10-9a12-5e7d8c4b3a66' as ProjectId, serviceName: 'demo', namespace: 'cs-demo' };
const target = { namespace: 'cs-demo', service: 'demo-blue', port: 80 };
const system = { names: new Set(['drop', 'auth', 'svc']), namespace: 'crewstation-system' };

describe('路由投影进资源台账（RFC-025 第三期后半）', () => {
  test('每条路由一条 route 记录：子对象是它的 IngressRoute，期望写全调和器渲染要用的（所属服务、前缀与优先级、目标、带命名空间的中间件链），展示字段写种类、Host、前缀与目标', () => {
    const routes: RouteEntry[] = [
      { host: 'demo.cs.localhost', domain: 'user', kind: 'prod', target, middlewares: ['drop', 'auth'] },
      { host: 'api.svc.cs.internal', pathPrefix: '/api/demo', domain: 'service', kind: 'internal-api', target, middlewares: ['drop', 'svc', 'strip-api-demo'] },
    ];
    expect(routes.map((route) => projectRoute(service, route, routeRef(service.serviceId, route.kind), system))).toEqual([
      { kind: 'route', ref: 'svc-1/prod', projectId: service.projectId,
        spec: { children: [{ kind: 'IngressRoute', namespace: 'cs-demo', name: 'demo-prod' }], service: 'demo', host: 'demo.cs.localhost', target,
          middlewares: [{ name: 'drop', namespace: 'crewstation-system' }, { name: 'auth', namespace: 'crewstation-system' }] },
        display: { role: 'prod', host: 'demo.cs.localhost', target: 'cs-demo/demo-blue' } },
      { kind: 'route', ref: 'svc-1/internal-api', projectId: service.projectId,
        spec: { children: [{ kind: 'IngressRoute', namespace: 'cs-demo', name: 'demo-internal-api' }], service: 'demo', host: 'api.svc.cs.internal', pathPrefix: '/api/demo', priority: PREFIX_ROUTE_PRIORITY, target,
          middlewares: [{ name: 'drop', namespace: 'crewstation-system' }, { name: 'svc', namespace: 'crewstation-system' }, { name: 'strip-api-demo' }] },
        display: { role: 'internal-api', host: 'api.svc.cs.internal', pathPrefix: '/api/demo', target: 'cs-demo/demo-blue' } },
    ]);
    expect(SERVICE_ROUTE_KINDS).toEqual(['prod', 'preview', 'service', 'internal-api']);
  });

  test('引用是 <服务>/<种类>；同一种路由摘掉又出现的顺延 ~2、~3', () => {
    expect(routeRef('svc-1', 'service')).toBe('svc-1/service');
    expect(routeRef('svc-1', 'internal-api', 2)).toBe('svc-1/internal-api~2');
    const route: RouteEntry = { host: 'api.svc.cs.internal', pathPrefix: '/api/demo', domain: 'service', kind: 'internal-api', target, middlewares: [] };
    expect(projectRoute(service, route, 'svc-1/internal-api~2', system).ref).toBe('svc-1/internal-api~2');
  });
});
