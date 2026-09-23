import { describe, expect, test } from 'bun:test';
import type { ObservedObject } from '../../domain/observation';
import { covers, routeCovered, routeObject } from './routeObjects';

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

  test('比对：期望的字段都在即一致（API Server 补的缺省与多出的标签不算）；缺字段、值不同、数组长度或次序不同都算不一致', () => {
    expect(covers({ a: 1, b: { c: 2, extra: true } }, { b: { c: 2 } })).toBe(true);
    expect(covers({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(covers({ a: [2, 1] }, { a: [1, 2] })).toBe(false);
    expect(covers({ a: [1, 2, 3] }, { a: [1, 2] })).toBe(false);
    expect(covers({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(covers(undefined, { a: 1 })).toBe(false);
    expect(covers('x', 'x')).toBe(true);
    const desired = routeObject(route);
    const live: ObservedObject = { kind: 'IngressRoute', metadata: { name: route.name, namespace: route.namespace, uid: 'u1', labels: { ...desired.metadata.labels, extra: 'kept' } }, spec: desired['spec'] };
    expect(routeCovered(live, desired)).toBe(true);
    expect(routeCovered(undefined, desired)).toBe(false);
    expect(routeCovered({ ...live, metadata: { ...live.metadata, labels: {} } }, desired)).toBe(false);
    expect(routeCovered({ ...live, spec: { entryPoints: ['web'], routes: [] } }, desired)).toBe(false);
  });
});
