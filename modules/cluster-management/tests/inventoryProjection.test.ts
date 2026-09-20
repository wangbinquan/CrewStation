import { describe, expect, test } from 'bun:test';
import { projectResources, configRevision } from '../domain/projection';
import { referencesOf } from '../domain/resourceGraph';
import { resourceStatus, containerDetails } from '../domain/resourceStatus';
import { pageResources, snapshotSummary } from '../application/queries';
import { catalog, facts, object, query } from './inventoryFixture';
import type { ResourceObject, InventoryFacts } from '../domain/inventory';
const at = '2026-09-20T00:00:00Z';
const project = (objects: ResourceObject[], data = facts) => projectResources(objects, structuredClone(data), 'crewstation-system', catalog, at);
const owner = (child: ResourceObject, parent: ResourceObject): ResourceObject => ({ ...child, metadata: { ...child.metadata, ownerReferences: [{ apiVersion: parent.apiVersion, kind: parent.kind, name: parent.metadata.name, uid: parent.metadata.uid!, controller: true }] } });

describe('inventory ownership, purpose and resource graph', () => {
  test('explicit system catalog follows UID owners and retained claims, never an entire namespace', () => {
    const api = object('Deployment', 'cs-api', 'crewstation-system', { replicas: 1, template: { spec: { containers: [{ name: 'main', image: 'api', envFrom: [{ secretRef: { name: 'api-env' } }] }] } } });
    const rs = owner(object('ReplicaSet', 'api-rs', 'crewstation-system'), api), pod = owner(object('Pod', 'api-pod', 'crewstation-system'), rs);
    const db = object('StatefulSet', 'postgres', 'crewstation-system', { replicas: 1, volumeClaimTemplates: [{ metadata: { name: 'data' } }] });
    const rows = project([api, rs, pod, db, object('Secret', 'api-env', 'crewstation-system'), object('PersistentVolumeClaim', 'data-postgres-0', 'crewstation-system'), object('Pod', 'external', 'crewstation-system'), object('Pod', 'dns', 'kube-system')]);
    expect(rows.map((r) => r.name)).toEqual(expect.arrayContaining(['cs-api', 'api-rs', 'api-pod', 'api-env', 'postgres', 'data-postgres-0']));
    expect(rows).toHaveLength(6); expect(rows.every((r) => r.ownership.scope === 'system')).toBe(true);
    expect(rows.find((r) => r.name === 'api-rs')?.topLevel).toBe(false);
    expect(rows.find((r) => r.name === 'cs-api')?.availableActions.find((a) => a.action === 'restart')?.enabled).toBe(true);
    expect(rows.find((r) => r.name === 'cs-api')?.availableActions.find((a) => a.action === 'delete')?.reason).toContain('安装');
    const invalid = { ...pod, metadata: { ...pod.metadata, ownerReferences: [{ ...pod.metadata.ownerReferences![0]!, uid: 'old-rs' }] } };
    expect(project([api, rs, invalid]).some((r) => r.name === 'api-pod')).toBe(false);
  });
  test('archived project, label conflict and managed orphan have explicit ownership and restricted commands', () => {
    const conflict = object('Pod', 'conflict'); conflict.metadata.labels = { 'crewstation.io/project': 'other' };
    const orphan = object('Pod', 'orphan', 'unknown'); orphan.metadata.labels = { 'app.kubernetes.io/managed-by': 'crewstation' };
    const data = structuredClone(facts); data.projects[0]!.state = 'archived';
    const rows = project([object('ConfigMap', 'old'), conflict, orphan], data);
    expect(rows.find((r) => r.name === 'old')?.ownership).toMatchObject({ scope: 'project', archived: true });
    expect(rows.filter((r) => r.ownership.scope === 'unresolved')).toHaveLength(2);
    expect(rows.every((r) => r.availableActions.every((a) => !a.enabled))).toBe(true);
  });
  test('all task purposes bind exact instances; pre-purpose native records are CLI; replacement loses task actions', () => {
    const pairs = [['dev-session', undefined, undefined, 'development-workspace'], ['business', undefined, undefined, 'business-workspace'], ['dev-session', 'parent', undefined, 'development-cli'], ['dev-session', 'parent', 'agent', 'development-agent'], ['business', 'parent', 'subtask', 'business-subtask'], ['profile-test', undefined, undefined, 'profile-test']] as const;
    const data = structuredClone(facts), pods = pairs.map(([kind, parentTaskId, purpose], i) => {
      const pod = object('Pod', `task-${i}`, kind === 'profile-test' ? 'crewstation-system' : 'cs-demo'); pod.metadata.labels = { 'crewstation.io/task': `tsk-${i}` };
      data.tasks.push({ taskId: `tsk-${i}`, projectId: 'p', namespace: pod.metadata.namespace!, podName: pod.metadata.name, podUid: pod.metadata.uid, pvcName: 'work', kind, state: 'running', profile: 'balanced', revision: '1', volumeMode: 'persistent', parentTaskId, purpose }); return pod;
    });
    expect(project(pods, data).map((r) => r.purpose).sort()).toEqual(pairs.map((p) => p[3]).sort());
    pods[0]!.metadata.uid = 'replacement'; const replaced = project(pods, data).find((r) => r.name === 'task-0')!;
    expect(replaced.purpose).toBe('unknown'); expect(replaced.taskId).toBeUndefined(); expect(replaced.availableActions.every((a) => !a.enabled)).toBe(true);
  });
  test('service purpose comes from project kind and slot role, HPA disables manual scale, retained references disable cleanup', () => {
    for (const [kind, purpose] of [['DigitalWorker', 'digital-worker-service'], ['APIProxy', 'api-proxy'], ['EventProducer', 'event-producer']] as const) {
      const data: InventoryFacts = structuredClone(facts); data.projects[0]!.kind = kind!;
      data.releases.push({ serviceId: 'svc_demo', serviceName: 'demo', namespace: 'cs-demo', physical: 'green', role: 'preview', state: 'ready', revision: 'slot1', maxReplicas: 3 });
      const d = object('Deployment', 'demo-green', 'cs-demo', { replicas: 1 }); d.metadata.labels = { 'crewstation.io/workload': 'service', 'crewstation.io/service': 'demo', 'crewstation.io/slot': 'green' };
      const hpa = object('HorizontalPodAutoscaler', 'auto', 'cs-demo', { scaleTargetRef: { kind: 'Deployment', name: 'demo-green' } });
      const row = project([d, hpa], data).find((r) => r.kind === 'Deployment')!;
      expect(row.purpose).toBe(purpose!); expect(row.slotRole).toBe('preview'); expect(row.availableActions.find((a) => a.action === 'scale')).toMatchObject({ enabled: false, reason: '副本数由 HPA 管理' });
    }
    const pod = object('Pod', 'p', 'cs-demo', { volumes: [{ persistentVolumeClaim: { claimName: 'work' } }], containers: [{ name: 'main', env: [{ valueFrom: { configMapKeyRef: { name: 'config' } } }] }] });
    expect(project([pod, object('PersistentVolumeClaim', 'work'), object('ConfigMap', 'config')]).filter((r) => r.kind !== 'Pod').every((r) => !r.availableActions.find((a) => a.action === 'delete')?.enabled)).toBe(true);
    expect(referencesOf(object('CronJob', 'cron', 'cs-demo', { jobTemplate: { spec: { template: { spec: { volumes: [{ secret: { secretName: 'cron-env' } }] } } } } }))).toContain('cs-demo/Secret/cron-env');
  });
  test('Running and Ready differ, OOM/exit/scheduling survive projection; terminal controllers are counted once', () => {
    const cron = object('CronJob', 'cron'), job = owner(object('Job', 'run'), cron), pod = owner(object('Pod', 'run-pod'), job);
    pod.status = { phase: 'Running', conditions: [{ type: 'Ready', status: 'False', message: 'not ready' }], containerStatuses: [{ name: 'main', ready: false, restartCount: 4, state: { waiting: { reason: 'CrashLoopBackOff' } }, lastState: { terminated: { reason: 'OOMKilled', exitCode: 137 } } }] }; pod.spec = { containers: [{ name: 'main', image: 'worker' }] };
    const rows = project([cron, job, pod]), snapshot = { id: 'snap', facts, sources: [], resources: rows, startedAt: at, finishedAt: at };
    expect(snapshotSummary(snapshot, query)).toMatchObject({ workloads: 1, pods: 1, runningPods: 1, readyPods: 0, abnormal: 1, standalonePods: 0 });
    expect(project([pod])[0]?.standalone).toBe(false); // Missing controller source must not reclassify its Pod as standalone.
    expect(rows.find((r) => r.kind === 'Pod')?.containers[0]).toMatchObject({ reason: 'CrashLoopBackOff', exitCode: 137, restarts: 4 });
    expect(pageResources(snapshot, { ...query, view: 'workloads' }).items).toHaveLength(1);
    job.status = { failed: 1, conditions: [] }; expect(resourceStatus(job, []).phase).toBe('Active');
    job.status = { conditions: [{ type: 'Failed', status: 'True' }] }; expect(resourceStatus(job, []).phase).toBe('Failed');
    pod.spec = { initContainers: [{ name: 'init', image: 'init' }] }; expect(containerDetails(pod)[0]?.init).toBe(true);
    expect(configRevision(pod)).toBe(configRevision({ ...pod, status: { phase: 'Pending' }, metadata: { ...pod.metadata, resourceVersion: '99' } }));
  });
});
