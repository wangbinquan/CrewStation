import { expect, test } from 'bun:test';
import { projectResources } from '../domain/projection';
import { catalog, facts, object, resourceIds } from './inventoryFixture';
import type { ResourceObject } from '../domain/observations';
const rows = (items: ResourceObject[]) => projectResources(items, facts, 'crewstation-system', catalog, '2026-09-28T00:00:00Z', resourceIds(items));
const pvc = object('PersistentVolumeClaim', 'retained', 'cs-demo', { volumeName: 'pv-work', storageClassName: 'local-path' });
const pv = object('PersistentVolume', 'pv-work', '', { claimRef: { namespace: 'cs-demo', name: 'retained', uid: pvc.metadata.uid }, capacity: { storage: '10Gi' }, hostPath: { path: '/private/host' }, csi: { secret: 'never-show' } });

test('retained claims expose their exact bound PV without host paths or new management actions', () => {
  const result = rows([pvc, pv]), volume = result.find((r) => r.kind === 'PersistentVolume')!;
  expect(volume).toMatchObject({ ownership: { scope: 'project', projectId: facts.projects[0]!.projectId }, namespace: '', facts: { claimUid: pvc.metadata.uid, capacity: '{"storage":"10Gi"}' } });
  expect(volume.availableActions.every((a) => !a.enabled)).toBe(true);
  expect(JSON.stringify(volume)).not.toContain('/private/host'); expect(JSON.stringify(volume)).not.toContain('never-show');
  expect(result.find((r) => r.kind === 'PersistentVolumeClaim')?.references).toContain('/PersistentVolume/pv-work');
});

test('same-name replacement, one-way binding and foreign claim do not inherit PV ownership', () => {
  for (const spec of [{ ...pv.spec as object, claimRef: { namespace: 'cs-demo', name: 'retained', uid: 'previous-instance' } }, { claimRef: { namespace: 'other', name: 'retained', uid: pvc.metadata.uid } }]) {
    expect(rows([pvc, { ...pv, spec }]).some((r) => r.kind === 'PersistentVolume')).toBe(false);
  }
  expect(rows([{ ...pvc, spec: { volumeName: 'different-pv' } }, pv]).some((r) => r.kind === 'PersistentVolume')).toBe(false);
});

test('mount projection carries only actual claim mounts, including per-container subpaths and init mounts', () => {
  const pod = object('Pod', 'worker', 'cs-demo', { volumes: [{ name: 'work', persistentVolumeClaim: { claimName: 'retained' } }, { name: 'scratch', emptyDir: {} }], containers: [{ name: 'worker', volumeMounts: [{ name: 'work', mountPath: '/work', subPath: 'repo' }, { name: 'work', mountPath: '/journal', readOnly: true }, { name: 'scratch', mountPath: '/tmp' }] }], initContainers: [{ name: 'prepare', volumeMounts: [{ name: 'work', mountPath: '/volume' }] }] });
  expect(rows([pod])[0]).toMatchObject({ mounts: [
    { claimName: 'retained', container: 'worker', mountPath: '/work', subPath: 'repo', readOnly: false, init: false },
    { claimName: 'retained', container: 'worker', mountPath: '/journal', readOnly: true, init: false },
    { claimName: 'retained', container: 'prepare', mountPath: '/volume', readOnly: false, init: true },
  ] });
});
