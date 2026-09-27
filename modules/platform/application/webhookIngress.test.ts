import { expect, test } from 'bun:test';
import { webhookIngressPolicy, webhookAwareAllowlist } from './webhookIngress';
import type { ProjectId, ServiceId } from '@crewstation/contracts';

const id = Bun.randomUUIDv7() as ServiceId;
const service = { serviceId: id, projectId: Bun.randomUUIDv7() as ProjectId, name: 'github-events', kind: 'EventProducer', state: 'active' } as const;
test('only exact active verified EventProducer POST ingress is external; maintenance stays closed', async () => {
  let path: string | undefined = '/hooks/github';
  let maintenance = false;
  let services: Array<{ serviceId: ServiceId; name: string; kind: string; state: string }> = [service];
  const policy = webhookIngressPolicy({ domain: 'svc.internal', services: async () => services,
    release: () => ({ activeWebhookIngress: async () => path }), maintenance: async () => maintenance ? { switches: { services: true }, reason: 'upgrade' } : undefined });
  const target = { host: 'github-events.svc.internal', method: 'POST', path: '/hooks/github' };
  expect(await policy(target)).toEqual({ kind: 'webhook' });
  for (const change of [{ host: 'github-events.cs.localhost' }, { host: 'api.svc.internal' }, { method: 'GET' }, { path: '/hooks/github/extra' }, { path: '/' }]) expect(await policy({ ...target, ...change })).toBeUndefined();
  path = undefined; expect(await policy(target)).toBeUndefined(); path = '/hooks/github';
  services = [{ ...service, kind: 'DigitalWorker' }]; expect(await policy(target)).toBeUndefined();
  services = [{ ...service, state: 'archived' }]; expect(await policy(target)).toBeUndefined();
  services = [service]; maintenance = true; expect(await policy(target)).toMatchObject({ kind: 'unavailable', message: 'upgrade' });
});

test('composition retains the normal workload evaluator and tolerates release startup', async () => {
  const evaluate = async () => ({ allowed: false, targetIdentity: 'platform-api' });
  const policy = webhookAwareAllowlist({ domain: 'svc.internal', services: async () => [service], release: () => undefined, maintenance: async () => undefined }, evaluate);
  expect(policy.evaluate).toBe(evaluate);
  expect(await policy.externalWebhook({ host: 'github-events.svc.internal', method: 'POST', path: '/hooks/github' })).toBeUndefined();
});
