import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, Resources, deploymentObject, serviceObject } from '@crewstation/k8s';
import type { SlotDeployer, SlotDeploySpec, SlotStatus } from '../../ports/delivery';

interface DeploymentStatus { replicas?: number; readyReplicas?: number; availableReplicas?: number; conditions?: Array<{ type: string; status: string; reason?: string; message?: string }> }

const slotName = (serviceName: string, physical: string): string => `${serviceName}-${physical}`;

/** 一个槽的两个对象：Deployment 与 Service（部署与 dry-run 用同一份渲染）。 */
function slotObjects(spec: SlotDeploySpec): [K8sObject, K8sObject] {
  const name = slotName(spec.serviceName, spec.physical);
  const selector = { [LABELS.service]: spec.serviceName, [LABELS.slot]: spec.physical };
  const labels = { [LABELS.project]: spec.projectSlug, [LABELS.service]: spec.serviceName, [LABELS.slot]: spec.physical, [LABELS.workload]: 'service', [LABELS.release]: spec.releaseId };
  return [
    deploymentObject({
      name, namespace: spec.namespace, labels, selector, replicas: spec.replicas ?? spec.manifest.spec.service.replicas,
      image: spec.image, command: spec.manifest.spec.service.command, port: spec.manifest.spec.service.port, healthPath: spec.manifest.spec.service.healthPath,
      env: Object.entries(spec.env).map(([k, v]) => ({ name: k, value: v })),
      resources: { cpu: spec.plan.cpu, memory: spec.plan.memory },
      imagePullPolicy: 'Always',
    }),
    serviceObject({ name, namespace: spec.namespace, selector, port: 80, targetPort: spec.manifest.spec.service.port, labels }),
  ];
}

/** 一个物理槽 = 一个 Deployment + 一个 Service；Pod 标签携带项目、服务、物理槽，供网关的 Pod 身份索引识别。 */
export function kubernetesSlotDeployer(k8s: K8sClient): SlotDeployer {
  return {
    deploy: async (spec) => {
      for (const object of slotObjects(spec)) await k8s.apply(object);
    },
    dryRun: async (spec) => {
      for (const object of slotObjects(spec)) await k8s.apply(object, { dryRun: true });
    },
    status: async (namespace, serviceName, physical): Promise<SlotStatus> => {
      const dep = await k8s.get<K8sObject & { status?: DeploymentStatus; spec?: { replicas?: number } }>(Resources.Deployment!, slotName(serviceName, physical), namespace);
      if (!dep) return { replicas: 0, readyReplicas: 0, state: 'failed', message: 'Deployment 不存在' };
      const replicas = dep.spec?.replicas ?? 0;
      const ready = dep.status?.readyReplicas ?? 0;
      const progressing = dep.status?.conditions?.find((c) => c.type === 'Progressing');
      if (progressing?.status === 'False') return { replicas, readyReplicas: ready, state: 'failed', message: progressing.message ?? progressing.reason ?? '部署停止推进' };
      if (ready >= replicas && replicas > 0 && (dep.status?.replicas ?? 0) === replicas) return { replicas, readyReplicas: ready, state: 'ready' };
      return { replicas, readyReplicas: ready, state: 'deploying' };
    },
    remove: async (namespace, serviceName, physical) => {
      const name = slotName(serviceName, physical);
      await k8s.delete(Resources.Deployment!, name, namespace);
      await k8s.delete(Resources.Service!, name, namespace);
    },
    // 下线只删这个版本的 Deployment；标签对不上说明之后已有新版本部署上来，旧工作负载早已不在（RFC-021 design §2）。
    removeWorkload: async (namespace, serviceName, physical, releaseIds) => {
      const name = slotName(serviceName, physical);
      const dep = await k8s.get<K8sObject>(Resources.Deployment!, name, namespace);
      if (!dep || !releaseIds.includes(dep.metadata.labels?.[LABELS.release] ?? '')) return true;
      await k8s.delete(Resources.Deployment!, name, namespace, { propagationPolicy: 'Background', ...(dep.metadata.uid ? { preconditions: { uid: dep.metadata.uid } } : {}) });
      return true;
    },
  };
}
