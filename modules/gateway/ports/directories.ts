import type { OperationRoute } from '@crewstation/contracts';
import type { ServiceId } from '@crewstation/contracts';

/** 网关眼里的一个服务；`archived` 决定它还该不该有路由与放行表条目。 */
export interface DirectoryService {
  serviceId: ServiceId;
  projectSlug: string;
  serviceName: string;
  namespace: string;
  identity: string;
  kind: 'DigitalWorker' | 'APIProxy' | 'EventProducer';
  archived: boolean;
}

/**
 * 由 project 模块提供。两个方法的取值范围**故意不同**：
 * - `listServices` 是「在册服务」，不含已归档——路由全量重算与放行表都按这份推导；
 * - `getService` 解析任一服务，含已归档的——归档动作本身要靠它才删得掉那个服务的路由
 *   （原先两个都建在「在册服务」上，于是 `project.archived` 到达时服务已经查不到，路由永远留在集群里）。
 */
export interface ServiceDirectory {
  listServices(): Promise<DirectoryService[]>;
  getService(serviceId: ServiceId): Promise<DirectoryService | undefined>;
}

/** 由 release 模块提供：两个物理槽的当前角色。 */
export interface SlotRoles {
  slotRoles(serviceId: ServiceId): Promise<{ prod: 'blue' | 'green'; preview: 'blue' | 'green' } | undefined>;
}

/** 由 api-catalog 模块提供：调用方已获授权的操作键、默认开放集合、已登记的 proxy 名。 */
export interface GrantSource {
  grantedOperations(callerIdentity: string): Promise<{ operations: string[]; defaultOpen: string[]; operationRoutes: OperationRoute[] }>;
  listCallers(): Promise<string[]>;
  proxyNameOf(serviceId: ServiceId): Promise<string | undefined>;
}

export interface HostNaming {
  prodHost(projectSlug: string): string;
  previewHost(projectSlug: string): string;
  serviceHost(serviceName: string): string;
  platformApiHost(): string;
}
