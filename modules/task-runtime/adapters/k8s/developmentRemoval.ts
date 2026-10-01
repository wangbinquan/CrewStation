import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { precondition } from '@crewstation/kernel';
import type { DevelopmentRemovalDecision, DevelopmentRemovalTarget } from '../../api/developmentCleanup';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import type { DevelopmentPhysicalStopEvidence } from '../../ports/developmentCleanup';
import { admittedSpec, allOriginalContainers, originalSecret } from './developmentCleanup';

/** Materials stay inside Task; Controller sees only a decision and the live CAS version. */
export async function inspectDevelopmentRemoval(k8s: K8sClient, env: TaskEnvironment, target: DevelopmentRemovalTarget,
  stopped?: DevelopmentPhysicalStopEvidence): Promise<DevelopmentRemovalDecision> {
  const object = await k8s.get<K8sObject>(Resources[target.kind]!, target.name, target.namespace, AbortSignal.timeout(15_000));
  if (!object) return { kind: 'absent' };
  if (target.namespace !== env.namespace || object.metadata.namespace !== env.namespace || object.metadata.name !== target.name
    || object.metadata.uid !== target.uid || !object.metadata.resourceVersion) throw precondition('原开发目标的身份或版本不符');
  if (target.kind === 'Pod') {
    if (target.name !== env.podName || target.uid !== env.native!.podUid) throw precondition('同名开发 Pod 不是原实例');
    admittedSpec(object, env);
    if (target.operation === 'stop-finalizer') {
      if (!stopped || !object.metadata.deletionTimestamp) throw precondition('原开发 finalizer 尚无独立停止事实');
      allOriginalContainers(env, stopped);
    }
  } else {
    if (!stopped || await k8s.get(Resources.Pod!, env.podName, env.namespace, AbortSignal.timeout(15_000))) throw precondition('原开发 Pod 尚未回收');
    allOriginalContainers(env, stopped);
    const admission = target.name === env.podName + '-admission';
    if (!admission && target.name !== env.podName + '-runner') throw precondition('目标不是原开发凭据');
    originalSecret(object, env, stopped, admission, stopped.admissionSecretUid);
  }
  return { kind: 'permitted', resourceVersion: object.metadata.resourceVersion };
}
