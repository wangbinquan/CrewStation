import { expect, test } from 'bun:test';
import type { K8sObject } from '@crewstation/k8s';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { stopMigrationJob } from './stoppedMigrationJob';
import { kubernetesClusterWriter } from './managedObjects';
import type { JobRender } from '../../domain/jobRender';

const job: JobRender = { namespace: 'cs-stop', name: 'migration-one', secret: 'migration-secret', releaseId: 'release-one', purpose: 'migration', image: 'test:one', command: ['sleep', '90'], env: {}, resources: { cpu: '1', memory: '1Gi' }, activeDeadlineSeconds: 1800, ttlSecondsAfterFinished: 3600 };
test('failed migration keeps a suspended name tombstone; late creation cannot launch and lingering Pods block proof', async () => {
  const k8s = createFakeK8sClient(), writer = kubernetesClusterWriter(k8s);
  expect(await stopMigrationJob(k8s, job)).toBe(false);
  const created = (await k8s.get(Resources.Job!, job.name, job.namespace))!;
  expect(created.spec).toMatchObject({ suspend: true }); expect(created.spec).not.toHaveProperty('ttlSecondsAfterFinished');
  expect(await writer.ensureJob(job)).toMatchObject({ uid: created.metadata.uid, created: false });
  expect(await stopMigrationJob(k8s, job)).toBe(false);
  await k8s.mergePatch(Resources.Job!, job.name, job.namespace, { status: { conditions: [{ type: 'Suspended', status: 'True' }] } });
  const pod = await k8s.create<K8sObject>({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'writer', namespace: job.namespace, labels: { 'batch.kubernetes.io/job-name': job.name } }, spec: {} });
  expect(await stopMigrationJob(k8s, job)).toBe(false);
  await k8s.delete(Resources.Pod!, 'writer', job.namespace, { preconditions: { uid: pod.metadata.uid } });
  expect(await stopMigrationJob(k8s, job)).toBe(true);
  const final = (await k8s.get(Resources.Job!, job.name, job.namespace))!; expect(final.metadata.uid).toBe(created.metadata.uid);
});
test('existing migration is suspended before proof; foreign names are never modified', async () => {
  const k8s = createFakeK8sClient(), writer = kubernetesClusterWriter(k8s); await writer.ensureJob(job);
  expect(await stopMigrationJob(k8s, job)).toBe(false);
  const object = (await k8s.get(Resources.Job!, job.name, job.namespace))!;
  expect(object.spec).toMatchObject({ suspend: true });
  await k8s.mergePatch(Resources.Job!, job.name, job.namespace, { metadata: { labels: { 'crewstation.io/release': 'foreign' } } });
  await expect(stopMigrationJob(k8s, job)).rejects.toMatchObject({ kind: 'precondition' });
});
