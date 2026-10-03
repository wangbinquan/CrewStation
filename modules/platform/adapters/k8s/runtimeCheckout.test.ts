import { expect, test } from 'bun:test';
import { BUILTIN_RESOURCES, ServiceIdSchema, UserIdSchema } from '@crewstation/contracts';
import { createFakeK8sClient } from '@crewstation/k8s';
import { newResourceId } from '@crewstation/kernel';
import { runtimeCheckout } from './runtimeCheckout';

test('runtime checkout keeps original service identity and receiver; only the immediate Secret/credential response holds the short-lived token', async () => {
  const id = ServiceIdSchema.parse(newResourceId()), k8s = createFakeK8sClient(), calls: unknown[] = [];
  const actor = { userId: UserIdSchema.parse(BUILTIN_RESOURCES.systemActor), isAdmin: true };
  const scm = { original: true, async getBinding(who: typeof actor, service: typeof id) { expect(this.original).toBe(true); calls.push(['binding', who, service]); return { httpUrl: 'https://original.git/service.git' }; },
    async issueSessionCredential(service: typeof id, minutes: number) { expect(this.original).toBe(true); calls.push(['credential', service, minutes]); return { token: 'controlled-checkout-only' }; } };
  const checkout = runtimeCheckout(scm, actor, k8s, async () => ({ name: 'original-service', namespace: 'original-namespace' }));
  const rendered = await checkout.checkoutFor(id), name = 'git-checkout-' + id.replaceAll('-', '');
  expect(rendered).toEqual({ repoUrl: 'https://original.git/service.git', credentialSecretName: name });
  expect(JSON.stringify(rendered)).not.toContain('controlled-checkout-only');
  expect(k8s.objects.get('v1/Secret/original-namespace/' + name)).toMatchObject({ metadata: { name, namespace: 'original-namespace', labels: { 'crewstation.io/service': 'original-service' } }, stringData: { token: 'controlled-checkout-only' } });
  expect(await checkout.repositoryFor(id)).toEqual({ repoUrl: 'https://original.git/service.git' });
  expect(await checkout.credentialFor(id)).toEqual({ token: 'controlled-checkout-only' });
  const before = k8s.objects.size;
  expect(await runtimeCheckout(scm, actor, k8s, async () => undefined).checkoutFor(id)).toBeUndefined(); expect(k8s.objects.size).toBe(before);
  expect(calls.filter((entry) => (entry as unknown[])[0] === 'credential').every((entry) => (entry as unknown[])[2] === 30)).toBe(true);
});
