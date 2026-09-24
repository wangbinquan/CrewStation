import type { K8sClient } from '@crewstation/k8s';
import { LABELS, jobObject } from '@crewstation/k8s';
import type { Release } from '../../domain/release';
import { BUILD_RESOURCES, JOB_TTL_SECONDS, buildScript, releaseJobName } from '../../domain/releaseJobs';
import type { ImageBuilder } from '../../ports/delivery';
import { readJobState } from './jobStatus';

export interface BuildKitSettings {
  builderImage: string;
  buildkitAddress: string;
  timeoutSeconds: number;
}

/** 构建 Job：克隆标签处的仓库，用 buildctl 向 buildkitd 提交 Dockerfile 构建并推送到平台注册表。 */
export function buildKitBuilder(k8s: K8sClient, settings: BuildKitSettings): ImageBuilder {
  return {
    start: async (spec) => {
      const name = releaseJobName({ id: spec.releaseId as Release['id'], ...(spec.legacyResourceId ? { legacyResourceId: spec.legacyResourceId } : {}) }, 'build');
      const script = buildScript(settings.buildkitAddress);
      await k8s.apply(jobObject({
        name, namespace: spec.namespace, image: settings.builderImage, command: ['sh', '-c', script],
        labels: { [LABELS.component]: 'build', [LABELS.release]: spec.releaseId },
        env: [
          { name: 'REPO_URL', value: spec.repoHttpUrl },
          { name: 'REF', value: spec.ref },
          { name: 'IMAGE', value: spec.image },
          { name: 'GIT_TOKEN', valueFrom: { secretKeyRef: { name: spec.credentialSecretName, key: 'token' } } },
        ],
        resources: { ...BUILD_RESOURCES },
        activeDeadlineSeconds: settings.timeoutSeconds,
        ttlSecondsAfterFinished: JOB_TTL_SECONDS,
      }));
      return { buildRef: name };
    },
    status: (buildRef, namespace) => readJobState(k8s, namespace, buildRef),
  };
}
