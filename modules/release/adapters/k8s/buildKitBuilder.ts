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
      // 刚签发的 GitLab 项目访问令牌偶尔还没在 Git HTTP 认证路径上生效，克隆会以 401 失败；退避重试三次。
      const script = [
        'set -eu',
        'AUTH_URL=$(echo "$REPO_URL" | sed "s#://#://oauth2:${GIT_TOKEN}@#")',
        'for attempt in 1 2 3; do',
        '  if git clone --quiet --depth 1 --branch "$REF" "$AUTH_URL" /work; then break; fi',
        '  if [ "$attempt" = 3 ]; then echo "clone failed after 3 attempts" >&2; exit 1; fi',
        '  sleep $((attempt * 5))',
        'done',
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
        // 这个 Pod 只做 git clone 和 buildctl 客户端，镜像在 buildkitd 里构建（它有自己的资源）；按客户端的负载请求，
        // 否则忙碌节点上 1 CPU 的预约会让发布一直排不进去、到截止时间才失败（2026-09-18 本机实测）。
        resources: { cpu: '250m', memory: '512Mi' },
        activeDeadlineSeconds: settings.timeoutSeconds,
        ttlSecondsAfterFinished: 3600,
      }));
      return { buildRef: name };
    },
    status: (buildRef, namespace) => readJobState(k8s, namespace, buildRef),
  };
}
