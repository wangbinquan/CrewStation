import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, Resources, secretObject } from '@crewstation/k8s';
import { isPlatformError, precondition } from '@crewstation/kernel';
import type { EnvironmentRebuild } from '../../domain/environmentRebuild';
import { podNameFor } from '../../domain/taskEnvironment';
import type { RebuildProvisioner } from '../../ports/recoveryCluster';
import { assertRebuildObject, rebuildLabel, removeRebuildObject } from './rebuildObjects';
import { ensureTaskPreview, taskPodObject } from './taskObjects';

type Secret = K8sObject & { data?: Record<string, string>; stringData?: Record<string, string>; immutable?: boolean };
const fingerprint = (record: EnvironmentRebuild) => createHash('sha256').update(JSON.stringify({ requestId: record.id, taskId: record.taskId, volume: record.input.expectedVolumeUid, profile: record.input.profile, image: record.image, secret: record.secretName, ...(record.nodeName ? { nodeName: record.nodeName } : {}) })).digest('hex');

async function readOrCreateSecret(k8s: K8sClient, record: EnvironmentRebuild, values: () => Promise<Record<string, string>>): Promise<Secret> {
  const found = await k8s.get<Secret>(Resources.Secret!, record.secretName, record.namespace);
  if (found) return found;
  const object: Secret = { ...secretObject({ name: record.secretName, namespace: record.namespace, stringData: await values(),
    labels: { [LABELS.task]: record.taskId, [rebuildLabel]: record.id } }), immutable: true };
  try { return await k8s.create(object); }
  catch (error) {
    // 响应丢失的下一次执行也走同一路径，不生成另一份令牌。
    if (!isPlatformError(error) || error.kind !== 'conflict') throw error;
    const existing = await k8s.get<Secret>(Resources.Secret!, record.secretName, record.namespace);
    if (!existing) throw error;
    return existing;
  }
}

function validatePod(pod: K8sObject, record: EnvironmentRebuild): string {
  const uid = assertRebuildObject(pod, record, record.podUid);
  const spec = pod.spec as { containers?: Array<{ image?: string; envFrom?: Array<{ secretRef?: { name?: string } }> }>; volumes?: Array<{ persistentVolumeClaim?: { claimName?: string } }>; initContainers?: unknown[]; affinity?: unknown };
  if (pod.metadata.deletionTimestamp || pod.metadata.annotations?.['crewstation.io/rebuild-intent'] !== fingerprint(record)
    || spec.containers?.length !== 1 || spec.containers[0]?.image !== record.image || spec.initContainers?.length
    || spec.containers[0]?.envFrom?.[0]?.secretRef?.name !== record.secretName
    || !spec.volumes?.some((volume) => volume.persistentVolumeClaim?.claimName === record.pvcName)
    || (record.nodeName && !isDeepStrictEqual(spec.affinity, { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchFields: [{ key: 'metadata.name', operator: 'In', values: [record.nodeName] }] }] } } }))) throw precondition('新容器与已确认的恢复方案不一致');
  return uid;
}

export function kubernetesRebuildProvisioner(k8s: K8sClient, workerUid: number): RebuildProvisioner {
  return {
    prepareSecret: async (record, values) => {
      const secret = await readOrCreateSecret(k8s, record, values);
      const uid = assertRebuildObject(secret, record, record.secretUid);
      const token = secret.stringData?.CS_RUNNER_TOKEN ?? (secret.data?.CS_RUNNER_TOKEN ? Buffer.from(secret.data.CS_RUNNER_TOKEN, 'base64').toString('utf8') : undefined);
      if (!token || secret.metadata.deletionTimestamp || !secret.immutable) throw precondition('恢复环境配置不完整，请重新检查');
      return { uid, token };
    },
    ensurePod: async (record, spec) => {
      let pod = await k8s.get(Resources.Pod!, record.podName, record.namespace);
      if (!pod) {
        const object = taskPodObject({ ...spec, source: undefined, envVars: {}, envSecretName: record.secretName }, workerUid);
        object.metadata.annotations = { 'crewstation.io/rebuild-intent': fingerprint(record) };
        try { pod = await k8s.create(object); }
        catch (error) {
          if (!isPlatformError(error) || error.kind !== 'conflict') throw error;
          pod = await k8s.get(Resources.Pod!, record.podName, record.namespace);
          if (!pod) throw error;
        }
      }
      return validatePod(pod, record);
    },
    ensurePreview: async (record, spec) => {
      // 沿用原路由名称，避免两个 Host 相同的 IngressRoute 同时竞争。
      await ensureTaskPreview(k8s, { ...spec, env: { ...spec.env, podName: podNameFor(record.taskId) } });
    },
    cleanup: async (record) => {
      await removeRebuildObject(k8s, Resources.Pod!, record.podName, record, record.podUid);
      await removeRebuildObject(k8s, Resources.Secret!, record.secretName, record, record.secretUid);
    },
  };
}
