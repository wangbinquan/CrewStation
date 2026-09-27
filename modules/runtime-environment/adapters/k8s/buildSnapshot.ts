import type { RuntimeImageBuildRender } from '@crewstation/contracts';
import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { precondition } from '@crewstation/kernel';

export interface BuildContainerStatus {
  readonly name: string;
  readonly state?: { readonly terminated?: { readonly exitCode: number; readonly message?: string }; readonly running?: unknown; readonly waiting?: unknown };
}
export interface BuildPod extends K8sObject {
  readonly status?: { readonly phase?: string; readonly containerStatuses?: readonly BuildContainerStatus[]; readonly initContainerStatuses?: readonly BuildContainerStatus[] };
}
export interface BuildSecret extends K8sObject { readonly data?: Record<string, string> }
export interface BuildClusterSnapshot { readonly job?: K8sObject; readonly pods: readonly BuildPod[]; readonly secret?: BuildSecret }

export const buildSelector = (plan: RuntimeImageBuildRender) => `crewstation.io/resource-id=${plan.resourceId}`;
export function assertBuildObject(object: K8sObject, plan: RuntimeImageBuildRender): void {
  const labels = object.metadata.labels;
  if (!object.metadata.uid || labels?.['crewstation.io/resource-id'] !== plan.resourceId || labels['crewstation.io/image-build'] !== plan.buildId || labels['crewstation.io/build-epoch'] !== String(plan.executionEpoch)) throw precondition('构建对象身份不匹配');
}

/** 直接读 API Server，不把 informer 的暂时缺失当作物理删除。 */
export async function readBuildSnapshot(k8s: K8sClient, plan: RuntimeImageBuildRender, signal: AbortSignal): Promise<BuildClusterSnapshot> {
  const [job, secret] = await Promise.all([
    k8s.get(Resources.Job!, plan.name, plan.namespace, signal),
    k8s.get<BuildSecret>(Resources.Secret!, plan.secret, plan.namespace, signal),
  ]);
  const pods: BuildPod[] = [];
  let cursor = '';
  do {
    const page = await k8s.listPage<BuildPod>(Resources.Pod!, plan.namespace, { labelSelector: buildSelector(plan), limit: 100, ...(cursor ? { continue: cursor } : {}), signal });
    pods.push(...page.items); cursor = page.continue;
  } while (cursor);
  for (const object of [job, secret, ...pods]) if (object) assertBuildObject(object, plan);
  return { ...(job ? { job } : {}), ...(secret ? { secret } : {}), pods };
}
