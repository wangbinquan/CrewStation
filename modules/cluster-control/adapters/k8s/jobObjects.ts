import type { K8sObject } from '@crewstation/k8s';
import { LABELS, jobObject, secretObject } from '@crewstation/k8s';
import type { JobRender } from '../../domain/jobRender';

const labelsOf = (job: JobRender) => ({ [LABELS.component]: job.purpose, [LABELS.release]: job.releaseId });

/**
 * 构建、迁移 Job（RFC-025 T8）：标签与 release 自己建时相同（构建的出向策略按组件标签放行）；凭据只从这一次的 Secret 引用，
 * Job 规格里只有不含凭据的明文变量。建了不改（Job 的模板不可改），结束后由 TTL 删。
 */
export function releaseJobObject(job: JobRender): K8sObject {
  const object = jobObject({
    name: job.name, namespace: job.namespace, image: job.image, command: [...job.command], labels: labelsOf(job),
    env: Object.entries(job.env).map(([name, value]) => ({ name, value })), resources: { ...job.resources },
    activeDeadlineSeconds: job.activeDeadlineSeconds, ttlSecondsAfterFinished: job.ttlSecondsAfterFinished,
  });
  (object.spec as { template: { spec: { containers: Array<Record<string, unknown>> } } }).template.spec.containers[0]!.envFrom = [{ secretRef: { name: job.secret } }];
  return object;
}

/** 这一次的凭据 Secret：不可变，内容是建的时候向 release 要来的；Job 结束（或流水线放弃）后由调和器删掉。 */
export function jobSecretObject(job: JobRender, values: Readonly<Record<string, string>>): K8sObject {
  return { ...secretObject({ name: job.secret, namespace: job.namespace, stringData: { ...values }, labels: labelsOf(job) }), immutable: true } as K8sObject;
}
