import { expect, test } from 'bun:test';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { planServiceRoutes } from '../../domain/routePlan';
import { traefikApplier } from './traefikApplier';

test('production route observation requires applied target, host, middleware and internal API route; desired rows alone do not prove routing', async () => {
  const k8s = createFakeK8sClient(), names = { systemNamespace: 'system', userAuthMiddleware: 'user', serviceAuthMiddleware: 'service', dropIdentityHeadersMiddleware: 'drop' };
  const routes = planServiceRoutes({ projectSlug: 'demo', serviceName: 'demo', namespace: 'demo', prodPhysical: 'green', previewPhysical: 'blue', hosts: { prod: 'demo.test', preview: 'preview.test', service: 'demo.internal' }, proxyName: 'demo', platformApiHost: 'api.internal' }, names).filter((route) => route.kind !== 'preview');
  const applier = traefikApplier(k8s, names);
  expect(await applier.observeRoutes!('demo', 'demo', routes)).toBe(false);
  await applier.applyRoutes('demo', 'demo', routes);
  expect(await applier.observeRoutes!('demo', 'demo', routes)).toBe(true);
  const route = await k8s.get(Resources.IngressRoute!, 'demo-prod', 'demo');
  await k8s.apply({ ...route!, spec: { routes: [] } });
  expect(await applier.observeRoutes!('demo', 'demo', routes)).toBe(false);
  await applier.applyRoutes('demo', 'demo', routes);
  await k8s.delete(Resources.IngressRoute!, 'demo-internal-api', 'demo');
  expect(await applier.observeRoutes!('demo', 'demo', routes)).toBe(false);
  expect(await applier.observeRoutes!('demo', 'demo', [])).toBe(false);
});
