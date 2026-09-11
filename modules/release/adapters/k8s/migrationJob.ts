import type { K8sClient } from '@crewstation/k8s';
import { LABELS, jobObject } from '@crewstation/k8s';
import type { MigrationRunner } from '../../ports/delivery';
import { readJobState } from './jobStatus';

/** 迁移 Job：用服务镜像执行 Manifest 声明的迁移命令，环境与槽一致但只连生产库。 */
export function migrationJobRunner(k8s: K8sClient, settings: { timeoutSeconds: number }): MigrationRunner {
  return {
    start: async (spec) => {
      const name = `migrate-${spec.releaseId.slice(-12)}`;
      await k8s.apply(jobObject({
        name, namespace: spec.namespace, image: spec.image, command: spec.command,
        labels: { [LABELS.component]: 'migration', [LABELS.release]: spec.releaseId },
        env: Object.entries(spec.env).map(([k, v]) => ({ name: k, value: v })),
        resources: { cpu: '500m', memory: '512Mi' },
        activeDeadlineSeconds: settings.timeoutSeconds,
      }));
      return { migrationRef: name };
    },
    status: (migrationRef, namespace) => readJobState(k8s, namespace, migrationRef),
  };
}
