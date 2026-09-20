import { newResourceId } from '@crewstation/kernel';
import type { Actor, UserId } from '@crewstation/contracts';
import type { InventoryFacts, ResourceObject, SystemComponent } from '../domain/inventory';
export const admin: Actor = { userId: '01a0bf5d-8f4b-7793-867c-efd7527b386b' as UserId, isAdmin: true };
export const facts: InventoryFacts = { complete: true, projects: [{ projectId: '01a0bf5d-8f4b-7178-82e1-9a99060b1192', name: 'Demo', slug: 'demo', namespace: 'cs-demo', kind: 'DigitalWorker', state: 'active', serviceId: '01a0bf5d-8f4b-737e-8dee-257334592476', serviceName: 'demo' }], tasks: [], releases: [], retained: [] };
export const catalog: SystemComponent[] = [{ kind: 'Deployment', name: 'cs-api', component: 'cs-api', purpose: 'platform-service', restart: true, impact: ['API connections restart'] }, { kind: 'StatefulSet', name: 'postgres', component: 'postgres', purpose: 'platform-infrastructure', restart: true, impact: ['Database reconnect'] }];
export function object(kind: string, name: string, namespace = 'cs-demo', spec: Record<string, unknown> = {}): ResourceObject {
  const apiVersion = ['Deployment', 'StatefulSet', 'ReplicaSet', 'DaemonSet'].includes(kind) ? 'apps/v1' : ['Job', 'CronJob'].includes(kind) ? 'batch/v1' : kind === 'HorizontalPodAutoscaler' ? 'autoscaling/v2' : 'v1';
  return { apiVersion, kind, metadata: { name, namespace, uid: `uid-${namespace}-${kind}-${name}`, resourceVersion: '1', generation: 1 }, spec };
}
export const query = { scope: 'all' as const, limit: 50 };

const registeredResources = new Map<string, string>();
export function resourceIds(objects: readonly ResourceObject[]): ReadonlyMap<string, string> {
  for (const object of objects) if (object.metadata.uid && !registeredResources.has(object.metadata.uid)) registeredResources.set(object.metadata.uid, newResourceId());
  return registeredResources;
}
