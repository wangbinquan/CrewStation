import { describe, expect, test } from 'bun:test';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import type { K8sObject } from '@crewstation/k8s';
import { conflict } from '@crewstation/kernel';
import { rebuildObjects } from '../adapters/k8s/rebuildObjects';
import { rebuildRenderOf } from '../domain/rebuildRender';
import type { WorkloadRender } from '../domain/workloadRender';

const intent = { id: 'request', volumeUid: 'volume-instance', intent: 'confirmed' };
const render: WorkloadRender = { pod: { name: 'rebuild-pod', namespace: 'cs-test', taskId: 'task', image: 'image', workerUid: 10001,
  resources: { cpu: '1', memory: '1Gi', storage: '10Gi' }, workload: 'dev-session', project: 'test', service: 'svc', pvc: 'work', secret: 'runner',
  labels: { 'crewstation.io/rebuild': intent.id }, annotations: { 'crewstation.io/rebuild-intent': intent.intent } } };
async function fixture() {
  const k8s = createFakeK8sClient();
  await k8s.create<K8sObject>({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { namespace: 'cs-test', name: 'work', uid: intent.volumeUid }, status: { phase: 'Bound' } });
  return { k8s, ops: rebuildObjects(k8s, render, intent) };
}

describe('调和器保卷重建对象', () => {
  test('仅接受完整保卷意图，拒绝空卷、检出和身份不符', () => {
    expect(rebuildRenderOf(intent, render)).toEqual(intent);
    for (const value of [undefined, [], {}, { ...intent, id: '' }]) expect(rebuildRenderOf(value, render)).toBeUndefined();
    for (const patch of [{ pvc: undefined }, { emptyDir: true as const }, { checkout: { repoUrl: 'git', branch: 'main', credentialSecretName: 'git' } }, { labels: {} }, { annotations: {} }]) expect(rebuildRenderOf(intent, { pod: { ...render.pod, ...patch } })).toBeUndefined();
  });
  test('已创建 Secret 重试不再次要值，Pod 严格按确认规格，UID 不符或外来对象均拒绝', async () => {
    const { k8s, ops } = await fixture(); let issued = 0;
    const values = async () => ({ CS_RUNNER_TOKEN: `token-${++issued}` });
    const secret = await ops.prepareSecret(values);
    expect(await ops.prepareSecret(values, secret.uid)).toEqual(secret); expect(issued).toBe(1);
    await expect(ops.prepareSecret(values, 'wrong')).rejects.toMatchObject({ kind: 'precondition' });
    const uid = await ops.ensurePod(); expect(await ops.ensurePod(uid)).toBe(uid);
    const original = (await k8s.get(Resources.Pod!, render.pod.name, render.pod.namespace))!;
    const containers = (original.spec as { containers: Array<Record<string, unknown>> }).containers;
    await k8s.mergePatch(Resources.Pod!, render.pod.name, render.pod.namespace, { spec: { containers: [{ ...containers[0], resources: { requests: { cpu: '1000m', memory: '1024Mi', 'ephemeral-storage': '10240Mi' }, limits: { cpu: '1000m', memory: '1024Mi', 'ephemeral-storage': '10240Mi' } } }] } });
    expect(await ops.ensurePod(uid)).toBe(uid);
    await expect(ops.ensurePod('wrong')).rejects.toMatchObject({ kind: 'precondition' });
    await k8s.mergePatch(Resources.Pod!, render.pod.name, render.pod.namespace, { spec: { initContainers: [{ name: 'unexpected' }] } });
    await expect(ops.ensurePod()).rejects.toMatchObject({ kind: 'precondition' });
    await k8s.mergePatch(Resources.Pod!, render.pod.name, render.pod.namespace, { metadata: { labels: { 'crewstation.io/rebuild': 'foreign' } } });
    await expect(ops.cleanup({})).rejects.toMatchObject({ kind: 'precondition' });
    expect(await k8s.get(Resources.Pod!, render.pod.name, render.pod.namespace)).toBeDefined();
  });
  test('卷换实例或租约中止时不建；清理只处理本次 Pod 和 Secret，不受丢卷影响', async () => {
    const { k8s, ops } = await fixture();
    await ops.prepareSecret(async () => ({ CS_RUNNER_TOKEN: 'token' })); await ops.ensurePod();
    await k8s.mergePatch(Resources.PersistentVolumeClaim!, 'work', 'cs-test', { metadata: { uid: 'replacement' } });
    await expect(ops.ensurePod()).rejects.toMatchObject({ kind: 'precondition' });
    const abort = new AbortController(); abort.abort();
    await expect(rebuildObjects(k8s, render, intent, abort.signal).cleanup({})).rejects.toThrow();
    await expect(rebuildObjects(k8s, render, intent, abort.signal).prepareSecret(async () => ({}))).rejects.toThrow();
    await ops.cleanup({}); await ops.cleanup({});
    expect((await k8s.get(Resources.PersistentVolumeClaim!, 'work', 'cs-test'))?.metadata.uid).toBe('replacement');
    expect(await k8s.get(Resources.Pod!, render.pod.name, 'cs-test')).toBeUndefined();
  });
  test('创建冲突可接续同一实例，缺令牌或非不可变 Secret 拒绝；其他错误不吞掉', async () => {
    const { k8s, ops } = await fixture(); const create = k8s.create.bind(k8s);
    k8s.create = async (object) => { await create(object); throw conflict('already created'); };
    // 用标准平台冲突模拟 API Server 已创建而客户端重放的竞争。
    const secret = await ops.prepareSecret(async () => ({ CS_RUNNER_TOKEN: 'token' }));
    expect(secret.token).toBe('token');
    await k8s.mergePatch(Resources.Secret!, 'runner', 'cs-test', { immutable: false });
    await expect(ops.prepareSecret(async () => ({}))).rejects.toMatchObject({ kind: 'precondition' });
    k8s.create = async () => { throw new Error('offline'); };
    await expect(ops.ensurePod()).rejects.toThrow('offline');
  });
});
