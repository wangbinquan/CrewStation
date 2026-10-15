import type { ClusterResource, ResourceRecord, ProjectId, ReleaseId, TaskId } from '../../../../packages/contracts';
import type { ProjectTopologyInput } from '../../../../apps/console/src/shared/topology/projectTopology';

const now = '2026-10-01T03:00:00.000Z';
const projectId = '01a0f000-0000-7000-8000-000000000001' as ProjectId;
const resource = (name: string, kind: string, extra: Partial<ClusterResource> = {}): ClusterResource => ({
  name, kind, resourceId: `resource:${name}`, uid: `uid:${name}`, apiVersion: 'v1', namespace: 'cs-knowledge',
  resourceVersion: '1', revision: '1', observedAt: now, createdAt: now, ownership: { scope: 'project', projectId, projectName: '知识协作助手', slug: 'knowledge', projectKind: 'DigitalWorker', archived: false },
  view: kind === 'Pod' ? 'pods' : kind === 'PersistentVolumeClaim' ? 'storage' : 'workloads',
  purpose: 'digital-worker-service', phase: 'Running', ready: true, abnormal: false, reason: '',
  topLevel: kind !== 'Pod', standalone: false, restarts: 0, labels: {}, owners: [], references: [], containers: [], facts: {}, availableActions: [], ...extra,
});
const record = (id: string, kind: ResourceRecord['kind'], extra: Partial<ResourceRecord> = {}): ResourceRecord => ({
  id, kind, owner: { module: 'task-runtime', ref: id }, phase: 'ready', phaseSince: now, conditions: [], children: [],
  generation: 1, observedGeneration: 1, actions: [], version: 1, createdAt: now, updatedAt: now, ...extra,
});
const child = (name: string, kind = 'Pod') => ({ name, kind, namespace: 'cs-knowledge', uid: `uid:${name}`, phase: 'present', ready: true });
const devNames = ['dev-work', 'dev-agent-1', 'dev-agent-2'];
const businessNames = ['business-work', 'business-agent-1', 'business-agent-2'];
const workspaceRecords = (names: string[], mode: 'development' | 'business') => names.map((name, i) => record(name, i ? 'agent-execution' : mode === 'development' ? 'dev-workspace' : 'business-workspace', {
  parentId: i ? names[0] : undefined, purpose: i ? mode === 'development' ? 'development-agent' : 'business-subtask' : mode === 'development' ? 'development-workspace' : 'business-workspace',
  children: [child(name)], display: { profile: 'Standard', ...(mode === 'development' ? { branch: 'main' } : {}) },
}));
const workspaceResources = (names: string[], mode: 'development' | 'business') => names.map((name, i) => resource(name, 'Pod', {
  taskId: name, parentTaskId: i ? names[0] : undefined, purpose: i ? mode === 'development' ? 'development-agent' : 'business-subtask' : mode === 'development' ? 'development-workspace' : 'business-workspace',
  references: [`cs-knowledge/PersistentVolumeClaim/${mode === 'development' ? 'dev' : 'business'}-volume`],
}));

export const runtimeFixture: ProjectTopologyInput = {
  project: { id: projectId, name: '知识协作助手', kind: 'DigitalWorker', namespace: 'cs-knowledge' },
  snapshot: { id: 'prototype-snapshot', observedAt: now, complete: true },
  slots: [
    { name: 'prod', active: true, tag: 'v2.4.0', releaseId: 'release:prod' as ReleaseId, replicas: 2, readyReplicas: 2, state: 'ready', host: 'knowledge.cs.localhost' },
    { name: 'preview', active: false, tag: 'v2.5.0', releaseId: 'release:preview' as ReleaseId, replicas: 1, readyReplicas: 1, state: 'ready', host: 'preview.knowledge.cs.localhost' },
  ],
  dataResources: (['production', 'development'] as const).map((env) => ({ id: `db:${env}`, projectId, kind: 'postgres', env, plan: 'db-small', state: 'ready', envVar: 'CS_DATABASE_URL', createdAt: now })),
  devSession: { taskId: 'dev-work' as TaskId, state: 'running', branch: 'main', previewHost: 'dev.knowledge.cs.localhost' },
  resources: [
    resource('prod-deploy', 'Deployment', { slotRole: 'prod', physicalSlot: 'green', desired: 2, readyReplicas: 2, releaseId: 'release:prod' }),
    resource('prod-pod-1', 'Pod', { slotRole: 'prod', physicalSlot: 'green' }), resource('prod-pod-2', 'Pod', { slotRole: 'prod', physicalSlot: 'green' }),
    resource('preview-deploy', 'Deployment', { slotRole: 'preview', physicalSlot: 'blue', desired: 1, readyReplicas: 1, releaseId: 'release:preview' }),
    resource('preview-pod', 'Pod', { slotRole: 'preview', physicalSlot: 'blue' }),
    ...workspaceResources(devNames, 'development'), ...workspaceResources(businessNames, 'business'),
    resource('dev-volume', 'PersistentVolumeClaim', { phase: 'Bound', facts: { capacity: '10Gi', requested: '10Gi' } }),
    resource('business-volume', 'PersistentVolumeClaim', { phase: 'Bound', facts: { capacity: '10Gi', requested: '10Gi' } }),
    resource('build-job', 'Job', { purpose: 'build', phase: 'Succeeded', releaseId: 'release:preview' }),
    resource('migration-job', 'Job', { purpose: 'migration', releaseId: 'release:preview' }),
    resource('migration-pod', 'Pod', { purpose: 'migration', owners: [{ kind: 'Job', name: 'migration-job', uid: 'uid:migration-job' }] }),
  ],
  records: [
    ...workspaceRecords(devNames, 'development'), ...workspaceRecords(businessNames, 'business'),
    record('dev-volume', 'volume', { parentId: 'dev-work', children: [child('dev-volume', 'PersistentVolumeClaim')] }),
    record('business-volume', 'volume', { parentId: 'business-work', children: [child('business-volume', 'PersistentVolumeClaim')] }),
    record('slot:prod', 'service-slot', { display: { role: 'prod', serviceId: 'service:knowledge', releaseId: 'release:prod', objectStorage: 'true' }, children: [child('prod-deploy', 'Deployment')] }),
    record('slot:preview', 'service-slot', { display: { role: 'preview', serviceId: 'service:knowledge', releaseId: 'release:preview', objectStorage: 'true' }, children: [child('preview-deploy', 'Deployment')] }),
    record('objects:prod', 'object-space', { display: { env: 'production', serviceId: 'service:knowledge', backend: 'Garage', usedBytes: '13529146982', reservedBytes: '0', quotaBytes: '21474836480' } }),
  ],
};
