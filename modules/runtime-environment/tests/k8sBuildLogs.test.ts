import { expect, test } from 'bun:test';
import { createFakeK8sClient } from '@crewstation/k8s';
import { readImageBuildLogs } from '../adapters/k8s/buildLogs';
import type { BuildPod, BuildSecret } from '../adapters/k8s/buildSnapshot';

test('构建日志遮盖原文、编码、docker auth 内口令，游标去重；没有 Secret 不读取日志', async () => {
  const k8s = createFakeK8sClient(), password = 'push-secret-123', token = 'npm-secret-456';
  const auth = Buffer.from(`builder:${password}`).toString('base64');
  const secret: BuildSecret = { apiVersion: 'v1', kind: 'Secret', metadata: { name: 's' }, data: { 'docker-config': Buffer.from(JSON.stringify({ auths: { 'registry.test': { auth } } })).toString('base64'), npm: Buffer.from(token).toString('base64') } };
  const pod: BuildPod = { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'p', namespace: 'ns' }, status: { containerStatuses: [{ name: 'buildctl', state: { running: {} } }] } };
  let output = `2026-01-01T00:00:00Z ${password} ${token} ${auth} ${Buffer.from(token).toString('base64')}\n`, calls = 0;
  k8s.logs = async () => { calls++; return new Blob([output]).stream(); };
  const first = await readImageBuildLogs(k8s, pod, secret, undefined, AbortSignal.timeout(1000));
  expect(first!.lines).toEqual(['[buildctl] 2026-01-01T00:00:00Z [REDACTED] [REDACTED] [REDACTED] [REDACTED]']);
  expect((await readImageBuildLogs(k8s, pod, secret, first!.cursor, AbortSignal.timeout(1000)))!.lines).toEqual([]);
  output += '2026-01-01T00:00:01Z next\npartial-npm-secr';
  expect((await readImageBuildLogs(k8s, pod, secret, first!.cursor, AbortSignal.timeout(1000)))!.lines).toEqual(['[buildctl] 2026-01-01T00:00:01Z next']);
  expect(await readImageBuildLogs(k8s, pod, undefined, undefined, AbortSignal.timeout(1000))).toBeUndefined(); expect(calls).toBe(3);
});
