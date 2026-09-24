import { expect, test } from 'bun:test';
import type { ObservedObject } from './observation';
import { lastWrittenAt, referencedSecrets } from './secretReferences';

const podSpec = {
  initContainers: [{ name: 'checkout', env: [{ name: 'CS_GIT_TOKEN', valueFrom: { secretKeyRef: { name: 'git-checkout-a', key: 'token' } } }, { name: 'PLAIN', value: 'x' }] }],
  containers: [{ name: 'main', envFrom: [{ secretRef: { name: 'task-1-runner-1' } }, { configMapRef: { name: 'cm' } }] }],
  volumes: [{ name: 'tls', secret: { secretName: 'tls-a' } }, { name: 'bundle', projected: { sources: [{ secret: { name: 'bundle-a' } }, { configMap: { name: 'cm' } }] } }, { name: 'work', emptyDir: {} }],
  imagePullSecrets: [{ name: 'pull-a' }],
};

test('工作负载引用的 Secret：Pod 规格与 Deployment、Job 的 Pod 模板里的 env、envFrom、卷与拉镜像凭据，带命名空间', () => {
  const pod: ObservedObject = { kind: 'Pod', metadata: { name: 'task-1', namespace: 'cs-a' }, spec: podSpec };
  const deployment: ObservedObject = { kind: 'Deployment', metadata: { name: 'demo-blue', namespace: 'cs-b' }, spec: { template: { spec: { containers: [{ name: 'svc', envFrom: [{ secretRef: { name: 'demo-blue-env-3' } }] }] } } } };
  const job: ObservedObject = { kind: 'Job', metadata: { name: 'build-1', namespace: 'cs-b' }, spec: { template: { spec: { containers: [{ name: 'build', env: [{ name: 'GIT_TOKEN', valueFrom: { secretKeyRef: { name: 'git-cred-b', key: 'token' } } }] }] } } } };
  expect([...referencedSecrets([pod, deployment, job])].sort()).toEqual(['cs-a/bundle-a', 'cs-a/git-checkout-a', 'cs-a/pull-a', 'cs-a/task-1-runner-1', 'cs-a/tls-a', 'cs-b/demo-blue-env-3', 'cs-b/git-cred-b']);
  // 形状不对的规格不报错，只是不算引用。
  expect(referencedSecrets([{ kind: 'Pod', metadata: { name: 'x' }, spec: { containers: 'bad' } }, { kind: 'Job', metadata: { name: 'y' }, spec: {} }]).size).toBe(0);
});

test('最近一次写入：创建时刻与字段管理者写入时刻里最晚的；都没有是 NaN', () => {
  expect(lastWrittenAt({ kind: 'Secret', metadata: { name: 's', creationTimestamp: '2026-09-12T00:00:00Z', managedFields: [{ time: '2026-09-24T08:00:00Z' }, {}] } })).toBe(Date.parse('2026-09-24T08:00:00Z'));
  expect(lastWrittenAt({ kind: 'Secret', metadata: { name: 's', creationTimestamp: '2026-09-12T00:00:00Z' } })).toBe(Date.parse('2026-09-12T00:00:00Z'));
  expect(lastWrittenAt({ kind: 'Secret', metadata: { name: 's' } })).toBeNaN();
});
