import type { K8sClient } from '@crewstation/k8s';
import { LABELS, jobObject } from '@crewstation/k8s';
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
      const name = `build-${spec.releaseId.slice(-12)}`;
      const script = [
        'set -eu',
        'AUTH_URL=$(echo "$REPO_URL" | sed "s#://#://oauth2:${GIT_TOKEN}@#")',
        'git clone --quiet --depth 1 --branch "$REF" "$AUTH_URL" /work',
        'cd /work',
        `buildctl --addr "${settings.buildkitAddress}" build --frontend dockerfile.v0 --local context=. --local dockerfile=. --output type=image,name="$IMAGE",push=true,registry.insecure=true`,
      ].join('\n');
      await k8s.apply(jobObject({
        name, namespace: spec.namespace, image: settings.builderImage, command: ['sh', '-c', script],
        labels: { [LABELS.component]: 'build', [LABELS.release]: spec.releaseId },
        env: [
          { name: 'REPO_URL', value: spec.repoHttpUrl },
          { name: 'REF', value: spec.ref },
          { name: 'IMAGE', value: spec.image },
          { name: 'GIT_TOKEN', valueFrom: { secretKeyRef: { name: spec.credentialSecretName, key: 'token' } } },
        ],
        resources: { cpu: '1', memory: '2Gi' },
        activeDeadlineSeconds: settings.timeoutSeconds,
        ttlSecondsAfterFinished: 3600,
      }));
      return { buildRef: name };
    },
    status: (buildRef, namespace) => readJobState(k8s, namespace, buildRef),
  };
}
