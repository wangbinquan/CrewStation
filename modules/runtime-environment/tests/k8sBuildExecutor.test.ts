import { expect, test } from 'bun:test';
import { Resources, type K8sObject } from '@crewstation/k8s';
import { runtimeImageBuildSecretValues } from '../application/buildSecretValues';
import { k8sBuildFixture } from './k8sBuildFixture';

test('执行器观测原 Pod，从自己的仓库读取 digest；替换 Pod、伪造仓库和代次均拒收', async () => {
  const f = k8sBuildFixture();
  expect((await f.executor.reconcile(f.build(), f.revision, 'run')).state).toBe('pending');
  const job = await f.k8s.create<K8sObject>({ apiVersion: 'batch/v1', kind: 'Job', metadata: f.metadata(f.plan.name) });
  const pod = await f.k8s.create<K8sObject>({ apiVersion: 'v1', kind: 'Pod', metadata: { ...f.metadata('build-pod'), ownerReferences: [{ apiVersion: 'batch/v1', kind: 'Job', name: job.metadata.name, uid: job.metadata.uid!, controller: true }] }, status: { phase: 'Running', containerStatuses: [{ name: 'buildctl', state: { terminated: { exitCode: 0, message: JSON.stringify({ 'containerimage.digest': f.digest, repository: 'attacker/repo' }) } } }] } });
  const result = await f.executor.reconcile(f.build(), f.revision, 'run');
  expect(result).toMatchObject({ state: 'succeeded', podUid: pod.metadata.uid, receipt: { reference: `${f.plan.repository}@${f.digest}` } });
  f.update({ podUid: pod.metadata.uid });
  await f.executor.inspect(f.build(), f.revision, result.receipt);
  expect(f.inspected).toEqual([`${f.plan.repository}@${f.digest}`, f.revision.baseImage!]);
  await expect(f.executor.inspect(f.build(), f.revision, { ...result.receipt!, reference: `registry.internal:5000/foreign/repo@${f.digest}` })).rejects.toThrow('不属于');
  await expect(f.executor.inspect(f.build(), f.revision, { ...result.receipt!, executionEpoch: 2 })).rejects.toThrow('不属于');
  f.update({ podUid: 'old-pod' });
  expect((await f.executor.reconcile(f.build(), f.revision, 'run')).state).toBe('unknown');
});

test('停止必须取得资源租约、确认 Job、所有 Pod、Secret 都不存在并撤销凭据', async () => {
  const f = k8sBuildFixture();
  await f.executor.reconcile(f.build(), f.revision, 'run'); f.update({ gitCredentialIds: ['git-1'] });
  const secret = await f.k8s.create({ apiVersion: 'v1', kind: 'Secret', metadata: f.metadata(f.plan.secret) });
  expect((await f.executor.reconcile(f.build(), f.revision, 'stop')).state).toBe('running'); expect(f.revoked).toEqual([]);
  await f.k8s.delete(Resources.Secret!, secret.metadata.name, f.plan.namespace);
  const pod = await f.k8s.create({ apiVersion: 'v1', kind: 'Pod', metadata: f.metadata('orphan-pod') });
  expect((await f.executor.reconcile(f.build(), f.revision, 'stop')).state).toBe('running');
  await f.k8s.delete(Resources.Pod!, pod.metadata.name, f.plan.namespace);
  f.lease(false); expect((await f.executor.reconcile(f.build(), f.revision, 'stop')).state).toBe('unknown'); expect(f.revoked).toEqual([]);
  f.lease(true); f.acceptStop(false); expect((await f.executor.reconcile(f.build(), f.revision, 'stop')).state).toBe('unknown');
  f.acceptStop(true); expect((await f.executor.reconcile(f.build(), f.revision, 'stop')).state).toBe('stopped'); expect(f.revoked).toEqual(['git-1']);
});

test('构建 Secret 不持久化值，取消途中已签发的 Git token 被撤销', async () => {
  const f = k8sBuildFixture(); await f.executor.reconcile(f.build(), f.revision, 'run');
  const values = runtimeImageBuildSecretValues(f.intents, f.credentials, async () => f.revision);
  const input = { recordId: f.plan.resourceId, buildId: f.plan.buildId, executionEpoch: 1 };
  expect(await values(input)).toMatchObject({ 'git-token': 'git-secret' });
  expect(f.build().gitCredentialIds).toEqual(['git-1']); expect(JSON.stringify(f.build())).not.toContain('git-secret');
  const cancel = runtimeImageBuildSecretValues(f.intents, { ...f.credentials, issueGit: async () => { f.update({ state: 'cancelling' }); return { id: 'late', token: 'late-secret' }; } }, async () => f.revision);
  await expect(cancel(input)).rejects.toThrow('取消'); expect(f.revoked).toEqual(['late']);
  await expect(values(input)).rejects.toThrow('已结束');
});
