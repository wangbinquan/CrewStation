import { expect, test } from 'bun:test';
import type { ClusterResource } from '@crewstation/contracts';
import { buildProjectTopology } from '../shared/topology/projectTopology';
import { buildSystemTopology } from '../shared/topology/systemTopology';
const resource = (kind: string, name: string, extra: Partial<ClusterResource> = {}): ClusterResource => ({ resourceId: name, uid: `uid-${name}`, kind, name, namespace: 'cs-demo', apiVersion: 'v1', resourceVersion: '1', revision: '1', observedAt: '', view: kind === 'Pod' ? 'pods' : kind === 'Deployment' ? 'workloads' : 'storage', ownership: { scope: 'system', component: name }, purpose: 'unknown', phase: 'Bound', ready: true, abnormal: false, reason: '', topLevel: true, standalone: true, restarts: 0, labels: {}, owners: [], references: [], containers: [], facts: {}, availableActions: [], ...extra });
const claim = resource('PersistentVolumeClaim', 'retained', { references: ['/PersistentVolume/pv'], facts: { volumeName: 'pv' } });
const volume = resource('PersistentVolume', 'pv', { namespace: '', references: ['cs-demo/PersistentVolumeClaim/retained'], facts: { claimUid: claim.uid } });
const snapshot = { id: 'snapshot', observedAt: '', complete: true };
const project = (resources: ClusterResource[]) => buildProjectTopology({ project: { id: 'project', name: 'Demo', namespace: 'cs-demo', kind: 'DigitalWorker' }, resources, records: [], slots: [], dataResources: [], snapshot }, (key) => key);

test('all retained/unmounted claims and bound volumes remain visible without any active workspace', () => {
  const graph = project([claim, volume]);
  expect(graph.nodes.map((n) => n.resourceId)).toEqual(expect.arrayContaining(['retained', 'pv']));
  expect(graph.edges).toContainEqual(expect.objectContaining({ from: claim.uid, to: volume.uid, kind: 'binds', evidence: 'observed' }));
  expect(graph.edges.every((e) => graph.nodes.some((n) => n.id === e.from) && graph.nodes.some((n) => n.id === e.to))).toBe(true);
});

test('a system workload outside the fixed architecture table and its storage are drawn', () => {
  const workload = resource('Deployment', 'new-component', { references: ['cs-demo/PersistentVolumeClaim/retained'] });
  const graph = buildSystemTopology({ resources: [workload, claim, volume], snapshot }, (key) => key);
  expect(graph.nodes.map((n) => n.resourceId)).toEqual(expect.arrayContaining(['new-component', 'retained', 'pv']));
  expect(graph.edges.some((e) => e.kind === 'mounts' && e.to === claim.uid)).toBe(true);
});

test('inventory task Pod survives missing ledger entry and still mounts its observed claim', () => {
  const pod = resource('Pod', 'live-task', { purpose: 'business-workspace', references: ['cs-demo/PersistentVolumeClaim/retained'] });
  const graph = project([pod, claim]);
  expect(graph.nodes.some((n) => n.id === pod.uid)).toBe(true);
  expect(graph.edges).toContainEqual(expect.objectContaining({ from: pod.uid, to: claim.uid, kind: 'mounts' }));
});

test('a stale same-name claim UID does not produce a binding edge', () => {
  expect(project([claim, { ...volume, facts: { claimUid: 'old' } }]).edges.some((e) => e.kind as string === 'binds')).toBe(false);
});

test('binding gaps are visible as incomplete and mount paths are not guessed from ancestry', () => {
  const pod = resource('Pod', 'mounted', { purpose: 'business-workspace', references: ['cs-demo/PersistentVolumeClaim/retained'], mounts: [{ container: 'runner', claimName: 'retained', mountPath: '/work', subPath: 'repo', readOnly: false, init: false }] });
  const graph = project([pod, claim]);
  expect(graph.complete).toBe(false); expect(graph.incompleteReason).toContain('topology.incomplete.binding');
  expect(graph.edges.find((e) => e.kind === 'mounts')?.label).toBe('runner: /work [subPath: repo]');
});

test('system Pod mount observations are folded into the owning component, with exact binding', () => {
  const controller = resource('Deployment', 'new');
  const pod = resource('Pod', 'owned', { standalone: false, owners: [{ kind: 'Deployment', name: 'new', uid: controller.uid }], references: ['cs-demo/PersistentVolumeClaim/retained'], mounts: [{ container: 'db', claimName: 'retained', mountPath: '/data', readOnly: true, init: false }] });
  const graph = buildSystemTopology({ resources: [controller, pod, claim, volume], snapshot }, (key) => key);
  expect(graph.edges).toContainEqual(expect.objectContaining({ from: controller.uid, to: claim.uid, kind: 'mounts', label: 'db: /data (RO)' }));
  expect(graph.nodes.filter((n) => n.resourceId === pod.resourceId)).toHaveLength(0);
});
