import { describe, expect, test } from 'bun:test';
import { routeObject } from './routeObjects';

const route = {
  namespace: 'cs-issues', name: 'issues-internal-api', service: 'issues', host: 'api.svc.cs.internal', pathPrefix: '/api/issues', priority: 100,
  target: { namespace: 'cs-issues', service: 'issues-blue', port: 80 },
  middlewares: [{ name: 'drop-identity-headers', namespace: 'crewstation-system' }, { name: 'forward-auth-service', namespace: 'crewstation-system' }, { name: 'strip-api-issues' }],
};

describe('调和器渲染的 IngressRoute（RFC-025 第三期后半）', () => {
  // 与 gateway 直接建时的样子逐字段一致（gatewayModule.test.ts 核对的规则与中间件），切换写入者时线上对象不变。
  test('与 gateway 直接建出的对象一致：匹配规则、优先级、目标、中间件（系统的跨命名空间）、平台标签与服务标签', () => {
    expect(routeObject(route)).toEqual({
      apiVersion: 'traefik.io/v1alpha1', kind: 'IngressRoute',
      metadata: { name: 'issues-internal-api', namespace: 'cs-issues', labels: { 'app.kubernetes.io/managed-by': 'crewstation', 'crewstation.io/service': 'issues', 'app.kubernetes.io/component': 'route' } },
      spec: { entryPoints: ['web'], routes: [{
        match: 'Host(`api.svc.cs.internal`) && PathPrefix(`/api/issues`)', kind: 'Rule', priority: 100,
        services: [{ name: 'issues-blue', port: 80, namespace: 'cs-issues' }], middlewares: route.middlewares,
      }] },
    });
  });
});
