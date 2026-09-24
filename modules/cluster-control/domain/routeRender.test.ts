import { describe, expect, test } from 'bun:test';
import { routeRenderOf } from './routeRender';

const spec = (extra: Record<string, unknown> = {}) => ({
  children: [{ kind: 'IngressRoute', namespace: 'cs-demo', name: 'demo-internal-api' }], service: 'demo', host: 'api.svc.cs.internal', pathPrefix: '/api/demo', priority: 100,
  target: { namespace: 'cs-demo', service: 'demo-blue', port: 80 }, middlewares: [{ name: 'drop-identity-headers', namespace: 'crewstation-system' }, { name: 'strip-api-demo' }], ...extra,
});

describe('路由记录的期望 → 渲染输入（RFC-025 第三期后半）', () => {
  test('字段齐全：对象名与命名空间取自 IngressRoute 子对象，前缀、优先级与中间件的命名空间照写', () => {
    expect(routeRenderOf(spec())).toEqual({
      namespace: 'cs-demo', name: 'demo-internal-api', service: 'demo', host: 'api.svc.cs.internal', pathPrefix: '/api/demo', priority: 100,
      target: { namespace: 'cs-demo', service: 'demo-blue', port: 80 }, middlewares: [{ name: 'drop-identity-headers', namespace: 'crewstation-system' }, { name: 'strip-api-demo' }],
    });
    const { pathPrefix: _prefix, priority: _priority, ...plain } = spec();
    expect(routeRenderOf(plain)).not.toHaveProperty('pathPrefix');
  });

  test('记录是数据：缺 IngressRoute 子对象、缺主机或服务、目标不全、中间件不对、前缀或优先级类型不对，都不渲染', () => {
    for (const broken of [
      { children: [{ kind: 'Service', namespace: 'cs-demo', name: 'x' }] }, { children: [{ kind: 'IngressRoute', name: 'no-namespace' }] },
      { host: '' }, { service: 7 }, { target: { namespace: 'cs-demo', service: 'demo-blue' } }, { target: 'demo-blue' },
      { middlewares: 'drop' }, { middlewares: [{ namespace: 'x' }] }, { middlewares: [{ name: 'x', namespace: 3 }] }, { pathPrefix: 5 }, { priority: '100' }, { unavailableMiddleware: 7 },
    ]) expect(routeRenderOf(spec(broken))).toBeUndefined();
  });

  // D13：待验证与正式主机的期望带说明页的中间件名；没有的（服务域、内部 API）不改指。
  test('说明页的中间件名照写；没有就没有', () => {
    expect(routeRenderOf(spec({ unavailableMiddleware: 'unavailable-demo-preview' }))?.unavailable).toEqual({ middleware: 'unavailable-demo-preview' });
    expect(routeRenderOf(spec())).not.toHaveProperty('unavailable');
  });
});
