import type { Actor, ServiceId } from '@crewstation/contracts';
import { secretObject } from '@crewstation/k8s';
import type { K8sClient } from '@crewstation/k8s';

interface SourceControl {
  getBinding(actor: Actor, id: ServiceId): Promise<{ httpUrl: string }>;
  issueSessionCredential(id: ServiceId, minutes: number): Promise<{ token: string }>;
}
/** Immediate checkout credentials remain confined to the original service Secret or rendering response. */
export function runtimeCheckout(scm: SourceControl, actor: Actor, k8s: K8sClient,
  resolve: (id: ServiceId) => Promise<{ name: string; namespace: string } | undefined>) {
  return {
    checkoutFor: async (serviceId: ServiceId) => {
      const [binding, svc, credential] = await Promise.all([scm.getBinding(actor, serviceId), resolve(serviceId), scm.issueSessionCredential(serviceId, 30)]);
      if (!svc) return undefined;
      const name = `git-checkout-${serviceId.replaceAll('-', '')}`;
      await k8s.apply(secretObject({ name, namespace: svc.namespace, stringData: { token: credential.token }, labels: { 'crewstation.io/service': svc.name } }));
      return { repoUrl: binding.httpUrl, credentialSecretName: name };
    },
    repositoryFor: async (serviceId: ServiceId) => ({ repoUrl: (await scm.getBinding(actor, serviceId)).httpUrl }),
    credentialFor: async (serviceId: ServiceId) => ({ token: (await scm.issueSessionCredential(serviceId, 30)).token }),
  };
}
