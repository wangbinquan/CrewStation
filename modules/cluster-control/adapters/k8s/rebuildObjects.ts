import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, Resources, resourcesMatch } from '@crewstation/k8s';
import { isPlatformError, precondition } from '@crewstation/kernel';
import type { RebuildRender } from '../../domain/rebuildRender';
import type { WorkloadRender } from '../../domain/workloadRender';
import type { RebuildRendering } from '../../ports/ledger';
import { objectCovered } from './coverage';
import { runnerSecretObject, workloadPodObject, workloadPreviewObjects } from './workloadObjects';

type Secret = K8sObject & { data?: Record<string, string>; stringData?: Record<string, string>; immutable?: boolean };

/** 重建对象带任务、请求和确认摘要；同名的外来实例绝不接续或删除。 */
function identity(object: K8sObject, render: WorkloadRender, rebuild: RebuildRender, uid?: string): string {
  if (!object.metadata.uid || (uid && object.metadata.uid !== uid) || object.metadata.labels?.[LABELS.task] !== render.pod.taskId
    || object.metadata.labels?.['crewstation.io/rebuild'] !== rebuild.id || object.metadata.annotations?.['crewstation.io/rebuild-intent'] !== rebuild.intent) throw precondition('恢复资源的实例或归属已变化，已停止操作');
  return object.metadata.uid;
}

/** 保留规格核验，但接受 Kubernetes 对资源单位的等值规范化。 */
function podMatches(found: K8sObject, render: WorkloadRender): boolean {
  const desired = workloadPodObject(render.pod);
  const spec = found.spec as { containers?: Array<Record<string, unknown>>; initContainers?: unknown[] };
  const expected = desired.spec as { containers: Array<{ resources: { requests: Record<string, string> } }> };
  if (spec.initContainers?.length || spec.containers?.length !== 1 || !resourcesMatch(spec.containers[0]?.resources, expected.containers[0]!.resources.requests)) return false;
  return objectCovered({ ...found, spec: { ...spec, containers: [{ ...spec.containers[0], resources: expected.containers[0]!.resources }] } }, desired);
}

/** 每次创建都直读卷 UID；没有创建或删除 PVC 的路径。 */
export function rebuildObjects(k8s: K8sClient, render: WorkloadRender, rebuild: RebuildRender, signal?: AbortSignal): RebuildRendering {
  const { pod } = render;
  const volume = async () => {
    signal?.throwIfAborted();
    const found = await k8s.get(Resources.PersistentVolumeClaim!, pod.pvc!, pod.namespace);
    if (!found || found.metadata.uid !== rebuild.volumeUid || found.metadata.deletionTimestamp || (found.status as { phase?: string } | undefined)?.phase !== 'Bound') throw precondition('原工作卷实例已变化，恢复停止');
  };
  const ensure = async (kind: 'Pod' | 'Secret', name: string, object: () => Promise<K8sObject> | K8sObject): Promise<K8sObject> => {
    await volume();
    const found = await k8s.get(Resources[kind]!, name, pod.namespace);
    if (found) return found;
    const desired = await object();
    signal?.throwIfAborted();
    try { return await k8s.create(desired); }
    catch (error) {
      if (!isPlatformError(error) || error.kind !== 'conflict') throw error;
      const current = await k8s.get(Resources[kind]!, name, pod.namespace);
      if (!current) throw error;
      return current;
    }
  };
  return {
    prepareSecret: async (values, expectedUid) => {
      const secret = await ensure('Secret', pod.secret, async () => runnerSecretObject(pod, await values())) as Secret;
      const uid = identity(secret, render, rebuild, expectedUid);
      const token = secret.stringData?.CS_RUNNER_TOKEN ?? (secret.data?.CS_RUNNER_TOKEN ? Buffer.from(secret.data.CS_RUNNER_TOKEN, 'base64').toString('utf8') : undefined);
      if (!token || !secret.immutable || secret.metadata.deletionTimestamp) throw precondition('恢复环境配置不完整，请重新检查');
      return { uid, token };
    },
    ensurePod: async (expectedUid) => {
      const found = await ensure('Pod', pod.name, () => workloadPodObject(pod));
      const uid = identity(found, render, rebuild, expectedUid);
      if (found.metadata.deletionTimestamp || !podMatches(found, render)) throw precondition('新容器与已确认的恢复方案不一致');
      await volume();
      return uid;
    },
    ensurePreview: async () => {
      await volume();
      if (render.preview) {
        signal?.throwIfAborted();
        await k8s.apply(workloadPreviewObjects({ ...render.preview, route: undefined })[0]!);
      }
    },
    cleanup: async (instances) => {
      for (const [kind, name, expectedUid] of [['Pod', pod.name, instances.podUid], ['Secret', pod.secret, instances.secretUid]] as const) {
        signal?.throwIfAborted();
        const found = await k8s.get(Resources[kind]!, name, pod.namespace);
        if (!found) continue;
        const uid = identity(found, render, rebuild, expectedUid);
        signal?.throwIfAborted();
        if (!found.metadata.deletionTimestamp) await k8s.delete(Resources[kind]!, name, pod.namespace, { gracePeriodSeconds: 30, preconditions: { uid } });
        if (await k8s.get(Resources[kind]!, name, pod.namespace)) throw new Error('等待本次恢复对象回收完成');
      }
    },
  };
}
