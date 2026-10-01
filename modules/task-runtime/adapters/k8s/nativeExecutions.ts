import { cleanupDevelopmentExecution } from './developmentCleanup';
import { isDeepStrictEqual } from 'node:util';
import type { K8sClient, K8sObject, ResourceRef } from '@crewstation/k8s';
import { LABELS, Resources, resourcesMatch, secretObject } from '@crewstation/k8s';
import { DEVELOPMENT_USAGE_BINDING_DIRECTORY, DEVELOPMENT_USAGE_DIRECTORY } from '@crewstation/contracts';
import { isPlatformError, precondition } from '@crewstation/kernel';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import { canonicalNativeIntent, EXECUTION_INTENT_ANNOTATION, nativeIntent, nativeIntentMatches, taskLabelMatches, WORKSPACE_TASK_LABEL } from '../../domain/physicalIdentity';
import type { NativeExecutionCluster } from '../../ports/cluster';
import { taskPodObject } from './taskObjects';
import type { WorkloadSafetyPort } from '../../ports/workloadSafety';
import { registerDevelopmentExecution, verifyDevelopmentExecution } from './developmentExecutions';

type Pod = K8sObject & { status?: { phase?: string } };
type Volume = K8sObject & { status?: { phase?: string } };
type Secret = K8sObject & { data?: Record<string, string>; stringData?: Record<string, string>; immutable?: boolean };
const intentKey = EXECUTION_INTENT_ANNOTATION;
const workspaceKey = WORKSPACE_TASK_LABEL;
const secretName = (env: TaskEnvironment) => `${env.podName}-runner`;
const intent = (env: TaskEnvironment) => env.render?.developmentUsageProtection !== undefined ? canonicalNativeIntent(env.id, env.native!) : nativeIntent(env.id, env.native!);

function owned(object: K8sObject, env: TaskEnvironment, expectedUid?: string): string {
  const uid = object.metadata.uid;
  if (!uid || (expectedUid && expectedUid !== uid) || !taskLabelMatches(object.metadata.labels?.[LABELS.task], env)
    || (object.metadata.labels?.[workspaceKey] !== env.native!.parentTaskId && !(env.legacyCluster?.native?.parentTaskId && object.metadata.labels?.[workspaceKey] === env.legacyCluster.native.parentTaskId)) || !nativeIntentMatches(object.metadata.annotations?.[intentKey], env)) {
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
  if (!pod?.metadata.uid || pod.metadata.deletionTimestamp || pod.status?.phase !== 'Running' || !taskLabelMatches(pod.metadata.labels?.[LABELS.task], parent) || typeof nodeName !== 'string') throw precondition('工作区容器尚未就绪，暂时不能新增 CLI');
  if (!volume?.metadata.uid || volume.metadata.deletionTimestamp || volume.status?.phase !== 'Bound' || !taskLabelMatches(volume.metadata.labels?.[LABELS.task], parent)
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
  if (env.render?.developmentUsageStorage) verifyDevelopmentStorage(pod, env);
  return uid;
}

function verifyDevelopmentStorage(pod: K8sObject, env: TaskEnvironment): void {
  const spec = pod.spec as { volumes?: Array<{ name?: string; emptyDir?: unknown }>; containers: Array<{ env?: Array<{ name: string; valueFrom?: unknown }>; volumeMounts?: Array<{ name?: string; mountPath?: string; readOnly?: boolean }> }> };
  const container = spec.containers[0]!;
  const volume = spec.volumes?.filter((v) => v.name === 'development-usage');
  const mount = container.volumeMounts?.filter((v) => v.name === 'development-usage');
  const bindingVolume = spec.volumes?.filter((v) => v.name === 'development-usage-binding');
  const bindingMount = container.volumeMounts?.filter((v) => v.name === 'development-usage-binding');
  if (env.native?.purpose !== 'agent' || volume?.length !== 1 || !isDeepStrictEqual(volume[0]?.emptyDir, {}) || mount?.length !== 1 || mount[0]?.mountPath !== DEVELOPMENT_USAGE_DIRECTORY || mount[0]?.readOnly === true
    || bindingVolume?.length !== 1 || !isDeepStrictEqual(bindingVolume[0]?.emptyDir, {}) || bindingMount?.length !== 1 || bindingMount[0]?.mountPath !== DEVELOPMENT_USAGE_BINDING_DIRECTORY || bindingMount[0]?.readOnly === true
    || !isDeepStrictEqual(container.env?.find((e) => e.name === 'CS_RUNTIME_POD_UID')?.valueFrom, { fieldRef: { fieldPath: 'metadata.uid' } })) throw precondition('开发数值私有日志布局与受理快照不一致');
}

/** 所有写入只针对本次执行 Pod／Secret；接口没有创建、修改或删除 PVC 的能力。 */
export function kubernetesNativeExecutions(k8s: K8sClient, workerUid: number, safety?: Pick<WorkloadSafetyPort, 'register'>): NativeExecutionCluster {
  return {
    cleanupDevelopment: (env, guard) => cleanupDevelopmentExecution(k8s, env, guard),
    inspectWorkspace: (parent) => inspectWorkspace(k8s, parent),
    prepare: async (env, values) => {
      const protection = await registerDevelopmentExecution(env, safety);
      const n = env.native!;
      const secret = await createOrRead<Secret>(k8s, Resources.Secret!, env, secretName(env), async () => ({
        ...secretObject({ name: secretName(env), namespace: env.namespace, stringData: await values(), labels: { [LABELS.task]: env.id, [workspaceKey]: n.parentTaskId } }),
        immutable: true,
      }));
      const secretUid = owned(secret, env, n.secretUid);
      const token = secret.stringData?.CS_RUNNER_TOKEN ?? (secret.data?.CS_RUNNER_TOKEN ? Buffer.from(secret.data.CS_RUNNER_TOKEN, 'base64').toString('utf8') : undefined);
      if (!secret.immutable || secret.metadata.deletionTimestamp || !token) throw precondition('CLI 环境配置不完整，停止启动');
      const pod = await createOrRead(k8s, Resources.Pod!, env, env.podName, async () => {
        const object = taskPodObject({ env, image: n.image, envVars: {}, envSecretName: secretName(env), resources: n.profile, nodeName: n.nodeName }, protection ? env.render!.workerUid : workerUid);
        object.metadata.annotations = { ...object.metadata.annotations, [intentKey]: intent(env) };
        return object;
      });
      const podUid = protection ? owned(pod, env, n.podUid) : verifyPod(pod, env);
      if (protection) verifyDevelopmentExecution(pod, protection);
      return { secretUid, podUid, token };
    },
    cleanup: async (env) => {
      if (env.render?.developmentUsageProtection !== undefined) throw precondition('等待开发数字排空与原执行停止屏障');
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
