import type { ServiceId } from '@crewstation/contracts';

interface WebhookIngressDeps {
  domain: string;
  services(): Promise<readonly { serviceId: ServiceId; name: string; kind: string; state: string }[]>;
  release(): { activeWebhookIngress(id: ServiceId): Promise<string | undefined> } | undefined;
  maintenance(id: ServiceId): Promise<{ switches: { services: boolean }; reason: string } | undefined>;
}

/** The external producer boundary grants no platform identity. Its signed webhook handler owns verification. */
export function webhookIngressPolicy(deps: WebhookIngressDeps) {
  return async (target: { host: string; method: string; path: string }) => {
    if (target.method !== 'POST' || !target.host.endsWith(`.${deps.domain}`)) return undefined;
    const service = (await deps.services()).find((s) => s.kind === 'EventProducer' && s.state === 'active' && `${s.name}.${deps.domain}` === target.host);
    if (!service) return undefined;
    const path = await deps.release()?.activeWebhookIngress(service.serviceId);
    if (!path || path !== target.path) return undefined;
    const maintenance = await deps.maintenance(service.serviceId);
    if (maintenance?.switches.services) return { kind: 'unavailable' as const, message: maintenance.reason };
    return { kind: 'webhook' as const };
  };
}

/** Compose both ingress policies without letting external callbacks impersonate a workload. */
export function webhookAwareAllowlist<T>(deps: WebhookIngressDeps, evaluate: T) {
  return { evaluate, externalWebhook: webhookIngressPolicy(deps) };
}
