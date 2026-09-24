import type { K8sObject } from '@crewstation/k8s';
import { serviceSlotObjects, serviceSlotSecret } from '@crewstation/k8s';
import { RESOURCE_GENERATION_ANNOTATION } from '../../domain/observation';
import type { SlotRender } from '../../domain/slotRender';

/** 运维重启的标记（C6）：写在 Pod 模板上，值一变 Deployment 就重新铺开。 */
export const RESTARTED_AT_ANNOTATION = 'crewstation.io/restarted-at';

/**
 * 服务槽的 Deployment 与 Service（RFC-025 T8）：与 release 自己部署时同一个构造函数（选择器建了就不能改，两边必须一样）；
 * 环境只从这一次部署的环境 Secret 引用，Deployment 的注解写渲染它的期望版本（记录的 generation）。
 */
export function slotWorkloadObjects(slot: SlotRender, generation: number): [K8sObject, K8sObject] {
  return serviceSlotObjects({
    namespace: slot.namespace, project: slot.project, service: slot.service, physical: slot.physical, releaseId: slot.releaseId, image: slot.image, command: slot.command,
    port: slot.port, healthPath: slot.healthPath, replicas: slot.replicas, resources: slot.resources, envFromSecret: slot.secret,
    annotations: { [RESOURCE_GENERATION_ANNOTATION]: String(generation) }, ...(slot.restartedAt ? { templateAnnotations: { [RESTARTED_AT_ANNOTATION]: slot.restartedAt } } : {}),
  });
}

/** 这一次部署的环境 Secret：不可变，内容是建的时候向 release 要来的（生产配置、数据连接串与平台约定变量，值不落台账）。 */
export function slotSecretObject(slot: SlotRender, values: Readonly<Record<string, string>>): K8sObject {
  return serviceSlotSecret({ namespace: slot.namespace, project: slot.project, service: slot.service, physical: slot.physical, releaseId: slot.releaseId, name: slot.secret }, values);
}
