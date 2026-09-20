import type { Actor, UserId } from '@crewstation/contracts';
import type { InventoryFacts, ResourceObject, SystemComponent } from '../domain/inventory';
export const admin: Actor = { userId: 'usr_0123456789abcdef0123456789abcdef' as UserId, isAdmin: true };
export const facts: InventoryFacts = { complete: true, projects: [{ projectId: 'prj_0123456789abcdef0123456789abcdef', name: 'Demo', slug: 'demo', namespace: 'cs-demo', kind: 'DigitalWorker', state: 'active', serviceId: 'svc_demo', serviceName: 'demo' }], tasks: [], releases: [], retained: [] };
export const catalog: SystemComponent[] = [{ kind: 'Deployment', name: 'cs-api', component: 'cs-api', purpose: 'platform-service', restart: true, impact: ['API connections restart'] }, { kind: 'StatefulSet', name: 'postgres', component: 'postgres', purpose: 'platform-infrastructure', restart: true, impact: ['Database reconnect'] }];
export function object(kind: string, name: string, namespace = 'cs-demo', spec: Record<string, unknown> = {}): ResourceObject {
  const apiVersion = ['Deployment', 'StatefulSet', 'ReplicaSet', 'DaemonSet'].includes(kind) ? 'apps/v1' : ['Job', 'CronJob'].includes(kind) ? 'batch/v1' : kind === 'HorizontalPodAutoscaler' ? 'autoscaling/v2' : 'v1';
  return { apiVersion, kind, metadata: { name, namespace, uid: `uid-${namespace}-${kind}-${name}`, resourceVersion: '1', generation: 1 }, spec };
}
export const query = { scope: 'all' as const, limit: 50 };
