import { WorkloadStartPermitSchema } from '@crewstation/contracts';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { k8sObjectCovers, LABELS, Resources } from '@crewstation/k8s';
import { precondition } from '@crewstation/kernel';
import { developmentCleanupSelection } from '../../domain/development/cleanupSelection';
import { requireDevelopmentCleanupEvidence } from '../../domain/development/cleanupEvidence';
import { canonicalNativeIntent, EXECUTION_INTENT_ANNOTATION, WORKSPACE_TASK_LABEL } from '../../domain/physicalIdentity';
import { hashRunnerToken } from '../../domain/runnerToken';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import type { DevelopmentCleanupGuard, DevelopmentPhysicalStopEvidence } from '../../ports/developmentCleanup';
import { developmentPod, verifyDevelopmentCleanupExecution } from './developmentExecutions';
import { taskPodObject } from './taskObjects';

type Secret = K8sObject & { immutable?: boolean; data?: Record<string, string>; stringData?: Record<string, string> };
type Container = { name: string; resources?: unknown; volumeMounts?: Array<{ readOnly?: boolean }> };
type Spec = { containers: Container[]; initContainers: Container[]; ephemeralContainers?: unknown[] };
const runnerName = (env: TaskEnvironment) => env.podName + '-runner';
function value(secret: Secret, key: string): string | undefined {
  return secret.stringData?.[key] ?? (secret.data?.[key] ? Buffer.from(secret.data[key]!, 'base64').toString('utf8') : undefined);
}
export function originalSecret(secret: Secret, env: TaskEnvironment, stop: DevelopmentPhysicalStopEvidence, admission: boolean, historicalUid?: string): string {
  const uid = secret.metadata.uid;
  if (!uid || !secret.immutable || secret.metadata.namespace !== env.namespace || secret.metadata.name !== (admission ? env.podName + '-admission' : runnerName(env))
    || secret.metadata.labels?.[LABELS.task] !== env.id) throw precondition('原开发凭据的不可变归属已变化');
  if (admission) {
    if (env.render?.developmentRemovalProtection !== undefined && (!historicalUid || uid !== historicalUid || uid !== stop.admissionSecretUid)) throw precondition('同名准入 Secret 不是持久的原历史 UID');
    const fields = { podUid: stop.startPermit.podUid, nodeUid: stop.startPermit.nodeUid, consumerId: stop.consumer.id, volumeUid: stop.consumer.volumeUid };
    if (Object.entries(fields).some(([key, expected]) => value(secret, key) !== expected)) throw precondition('开发准入凭据不是原工作卷许可');
  } else {
    const token = value(secret, 'CS_RUNNER_TOKEN');
    if (uid !== env.native!.secretUid || secret.metadata.labels?.[WORKSPACE_TASK_LABEL] !== env.native!.parentTaskId
      || secret.metadata.annotations?.[EXECUTION_INTENT_ANNOTATION] !== canonicalNativeIntent(env.id, env.native!) || !token || hashRunnerToken(token) !== env.runnerTokenHash) throw precondition('开发 Runner 凭据不是原实例与原令牌');
  }
  return uid;
}
function expectedPod(env: TaskEnvironment): K8sObject {
  return taskPodObject({ env, image: env.native!.image, envVars: {}, envSecretName: runnerName(env), resources: env.native!.profile, nodeName: env.native!.nodeName }, env.render!.workerUid);
}
export function admittedSpec(object: K8sObject, env: TaskEnvironment): void {
  verifyDevelopmentCleanupExecution(object, developmentPod(env));
  const desired = structuredClone(expectedPod(env).spec) as Spec, live = object.spec as Spec;
  if (live.ephemeralContainers?.length) throw precondition('原开发 Pod 的受理容器集合已变化');
  for (const key of ['containers', 'initContainers'] as const) {
    for (let index = 0; index < desired[key].length; index++) {
      const container = desired[key][index]!, actual = live[key][index];
      delete container.resources; // The protected verifier checks normalized main resources; gate API defaults are independent.
      for (let mount = 0; mount < (container.volumeMounts?.length ?? 0); mount++) {
        const expected = container.volumeMounts![mount]!;
        if (expected.readOnly === false && actual?.volumeMounts?.[mount]?.readOnly === undefined) delete expected.readOnly;
      }
    }
  }
  if (!k8sObjectCovers(live, desired)) throw precondition('原开发 Pod 的完整受理规格已变化');
}
export function allOriginalContainers(env: TaskEnvironment, stopped: DevelopmentPhysicalStopEvidence): void {
  const spec = expectedPod(env).spec as Spec;
  for (const [kind, containers] of [['init', spec.initContainers], ['container', spec.containers]] as const) {
    if (containers.some((container) => !stopped.stopProof.containers.some((proof) => proof.kind === kind && proof.name === container.name))) throw precondition('原开发 Pod 的全部容器停止证明尚未齐全');
  }
}
/** No finalizer mutation, no parent Pod/PVC operation, and no Kubernetes I/O before the saved digital permit. */
export async function cleanupDevelopmentExecution(k8s: K8sClient, env: TaskEnvironment, guard: DevelopmentCleanupGuard): Promise<void> {
  const selection = developmentCleanupSelection(env);
  if (!selection) throw precondition('原开发清理选择尚未固定');
  requireDevelopmentCleanupEvidence(env.native!.developmentCleanup, selection);
  const selected = env.render?.developmentRemovalProtection !== undefined;
  if (selected && !guard.admissionSecretUid) throw precondition('原准入 Secret 回执读取能力未装配');
  await guard.current();
  const historicalUid = selected ? await guard.admissionSecretUid!() : undefined;
  if (selected && !WorkloadStartPermitSchema.shape.podUid.safeParse(historicalUid).success) throw precondition('原准入 Secret 历史 UID 尚未取得');
  const current = async () => {
    await guard.current();
    if (selected && await guard.admissionSecretUid!() !== historicalUid) throw precondition('原准入 Secret 历史 UID 已冲突');
  };
  const pod = await k8s.get(Resources.Pod!, env.podName, env.namespace, AbortSignal.timeout(15_000));
  if (pod) {
    if (pod.metadata.uid !== env.native!.podUid) throw precondition('同名开发 Pod 已被替换');
    admittedSpec(pod, env); await current();
    await k8s.delete(Resources.Pod!, env.podName, env.namespace, { gracePeriodSeconds: 30, preconditions: { uid: env.native!.podUid } });
    if (await k8s.get(Resources.Pod!, env.podName, env.namespace, AbortSignal.timeout(15_000))) throw precondition('等待原开发 Pod 与 Controller 停止 finalizer 完成', { code: 'runtime_original_stop_waiting' });
  }
  const stopped = await guard.stopped(); allOriginalContainers(env, stopped);
  for (const admission of [false, true]) {
    const name = admission ? env.podName + '-admission' : runnerName(env);
    const secret = await k8s.get<Secret>(Resources.Secret!, name, env.namespace, AbortSignal.timeout(15_000));
    if (!secret) continue;
    const uid = originalSecret(secret, env, stopped, admission, historicalUid); await current();
    await k8s.delete(Resources.Secret!, name, env.namespace, { preconditions: { uid } });
    if (await k8s.get(Resources.Secret!, name, env.namespace, AbortSignal.timeout(15_000))) throw precondition('等待原开发凭据回收确认', { code: 'runtime_original_stop_waiting' });
  }
}
