import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { K8sClient, K8sObject, ResourceRef } from '@crewstation/k8s';
import { LABELS, Resources, secretObject } from '@crewstation/k8s';
import { isPlatformError, precondition } from '@crewstation/kernel';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import type { NativeExecutionCluster } from '../../ports/cluster';
import { taskPodObject } from './taskObjects';

type Pod = K8sObject & { status?: { phase?: string } };
type Volume = K8sObject & { status?: { phase?: string } };
type Secret = K8sObject & { data?: Record<string, string>; stringData?: Record<string, string>; immutable?: boolean };
const intentKey = 'crewstation.io/cli-intent';
const workspaceKey = 'crewstation.io/workspace-task';
const secretName = (env: TaskEnvironment) => `${env.podName}-runner`;
function quantity(value: string): [bigint, bigint] | undefined {
  const match = /^(\d+(?:\.\d+)?|\.\d+)([numkKMGTPE]|[KMGTPE]i|[eE][+-]?\d+)?$/.exec(value);
  if (!match) return undefined;
  const [whole = '0', decimal = ''] = match[1]!.split('.'), unit = match[2] ?? '';
  const powers: Record<string, number> = { n: -9, u: -6, m: -3, '': 0, k: 3, K: 3, M: 6, G: 9, T: 12, P: 15, E: 18 };
  const binary = unit.endsWith('i') ? BigInt(1024) ** BigInt('KMGTPE'.indexOf(unit[0]!) + 1) : 1n;
  const exponent = unit.endsWith('i') ? 0 : (powers[unit] ?? Number(unit.slice(1)));
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 30 || decimal.length > 30) return undefined;
  return [BigInt(`${whole || '0'}${decimal}`) * binary * 10n ** BigInt(Math.max(0, exponent)), 10n ** BigInt(decimal.length + Math.max(0, -exponent))];
}
function resourcesMatch(actual: unknown, expected: Record<string, string>): boolean {
  const resources = actual as Record<string, Record<string, string>> | undefined;
  return ['requests', 'limits'].every((kind) => {
    const values = resources?.[kind];
    if (!values || !isDeepStrictEqual(Object.keys(values).sort(), Object.keys(expected).sort())) return false;
    return Object.entries(expected).every(([key, value]) => {
      if (values[key] === value) return true;
      const a = quantity(String(values[key])), b = quantity(value);
      return a && b && a[0] * b[1] === b[0] * a[1];
    });
  });
}
const intent = (env: TaskEnvironment) => {
  const n = env.native!;
  return createHash('sha256').update(JSON.stringify([env.id, n.parentTaskId, n.pvcUid, n.nodeName, n.runnerId, n.agentId, n.terminalId, n.fingerprint, n.profile, n.image])).digest('hex');
};

function owned(object: K8sObject, env: TaskEnvironment, expectedUid?: string): string {
  const uid = object.metadata.uid;
  if (!uid || (expectedUid && expectedUid !== uid) || object.metadata.labels?.[LABELS.task] !== env.id
    || object.metadata.labels?.[workspaceKey] !== env.native!.parentTaskId || object.metadata.annotations?.[intentKey] !== intent(env)) {
    throw precondition('CLI 执行资源的归属或实例已变化，停止操作该资源');
  }
  return uid;
}

async function createOrRead<T extends K8sObject>(k8s: K8sClient, ref: ResourceRef, env: TaskEnvironment, name: string, create: () => Promise<T>): Promise<T> {
  const found = await k8s.get<T>(ref, name, env.namespace);
  if (found) return found;
  try {
    const object = await create();
    object.metadata.annotations = { ...object.metadata.annotations, [intentKey]: intent(env) };
    return await k8s.create(object);
  }
  catch (error) {
    if (!isPlatformError(error) || error.kind !== 'conflict') throw error;
    const existing = await k8s.get<T>(ref, name, env.namespace);
    if (!existing) throw error;
    return existing;
  }
}

async function inspectWorkspace(k8s: K8sClient, parent: TaskEnvironment) {
  const [pod, volume] = await Promise.all([k8s.get<Pod>(Resources.Pod!, parent.podName, parent.namespace), k8s.get<Volume>(Resources.PersistentVolumeClaim!, parent.pvcName, parent.namespace)]);
  const nodeName = (pod?.spec as { nodeName?: string } | undefined)?.nodeName;
  const modes = (volume?.spec as { accessModes?: string[] } | undefined)?.accessModes;
  const volumes = (pod?.spec as { volumes?: Array<{ persistentVolumeClaim?: { claimName?: string } }> } | undefined)?.volumes;
  if (!pod?.metadata.uid || pod.metadata.deletionTimestamp || pod.status?.phase !== 'Running' || pod.metadata.labels?.[LABELS.task] !== parent.id || typeof nodeName !== 'string') throw precondition('工作区容器尚未就绪，暂时不能新增 CLI');
  if (!volume?.metadata.uid || volume.metadata.deletionTimestamp || volume.status?.phase !== 'Bound' || volume.metadata.labels?.[LABELS.task] !== parent.id
    || !volumes?.some((v) => v.persistentVolumeClaim?.claimName === parent.pvcName)) throw precondition('原工作卷尚未就绪或归属已变化，不能新增 CLI');
  if (modes?.includes('ReadWriteOncePod') || !modes?.some((mode) => mode === 'ReadWriteOnce' || mode === 'ReadWriteMany')) throw precondition('当前工作卷不支持多个 CLI 共享写入，请由管理员配置共享工作卷');
  return { podUid: pod.metadata.uid, pvcUid: volume.metadata.uid, nodeName };
}

function verifyPod(pod: K8sObject, env: TaskEnvironment): string {
  const n = env.native!, uid = owned(pod, env, n.podUid);
  const spec = pod.spec as { containers?: Array<{ image?: string; envFrom?: unknown; resources?: unknown }>; volumes?: Array<{ persistentVolumeClaim?: { claimName?: string } }>; initContainers?: unknown[]; affinity?: unknown };
  const resources = { cpu: n.profile.cpu, memory: n.profile.memory, 'ephemeral-storage': n.profile.storage };
  if (pod.metadata.deletionTimestamp || spec.containers?.length !== 1 || spec.containers[0]?.image !== n.image || spec.initContainers?.length
    || !isDeepStrictEqual(spec.containers[0]?.envFrom, [{ secretRef: { name: secretName(env) } }])
    || !resourcesMatch(spec.containers[0]?.resources, resources)
    || !spec.volumes?.some((v) => v.persistentVolumeClaim?.claimName === env.pvcName)
    || !isDeepStrictEqual(spec.affinity, { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchFields: [{ key: 'metadata.name', operator: 'In', values: [n.nodeName] }] }] } } })) {
    throw precondition('CLI 容器与已受理的资源、工作卷或节点不一致');
  }
  return uid;
}

/** 所有写入只针对本次执行 Pod／Secret；接口没有创建、修改或删除 PVC 的能力。 */
export function kubernetesNativeExecutions(k8s: K8sClient, workerUid: number): NativeExecutionCluster {
  return {
    inspectWorkspace: (parent) => inspectWorkspace(k8s, parent),
    prepare: async (env, values) => {
      const n = env.native!;
      const secret = await createOrRead<Secret>(k8s, Resources.Secret!, env, secretName(env), async () => ({
        ...secretObject({ name: secretName(env), namespace: env.namespace, stringData: await values(), labels: { [LABELS.task]: env.id, [workspaceKey]: n.parentTaskId } }),
        immutable: true,
      }));
      const secretUid = owned(secret, env, n.secretUid);
      const token = secret.stringData?.CS_RUNNER_TOKEN ?? (secret.data?.CS_RUNNER_TOKEN ? Buffer.from(secret.data.CS_RUNNER_TOKEN, 'base64').toString('utf8') : undefined);
      if (!secret.immutable || secret.metadata.deletionTimestamp || !token) throw precondition('CLI 环境配置不完整，停止启动');
      const pod = await createOrRead(k8s, Resources.Pod!, env, env.podName, async () => {
        const object = taskPodObject({ env, image: n.image, envVars: {}, envSecretName: secretName(env), resources: n.profile, nodeName: n.nodeName }, workerUid);
        object.metadata.annotations = { [intentKey]: intent(env) };
        return object;
      });
      return { secretUid, podUid: verifyPod(pod, env), token };
    },
    cleanup: async (env) => {
      for (const [ref, name, expectedUid] of [[Resources.Pod!, env.podName, env.native!.podUid], [Resources.Secret!, secretName(env), env.native!.secretUid]] as const) {
        const object = await k8s.get(ref, name, env.namespace);
        if (!object) continue;
        const uid = owned(object, env, expectedUid);
        await k8s.delete(ref, name, env.namespace, { gracePeriodSeconds: 30, preconditions: { uid } });
        if (await k8s.get(ref, name, env.namespace)) throw new Error('等待 CLI 执行资源退出');
      }
    },
  };
}
