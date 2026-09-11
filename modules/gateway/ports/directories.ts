import type { ServiceId } from '@crewstation/contracts';

/** 由 project 模块提供。 */
export interface ServiceDirectory {
  listServices(): Promise<Array<{ serviceId: ServiceId; projectSlug: string; serviceName: string; namespace: string; identity: string; kind: 'DigitalWorker' | 'APIProxy' | 'EventProducer' }>>;
  getService(serviceId: ServiceId): Promise<{ serviceId: ServiceId; projectSlug: string; serviceName: string; namespace: string; identity: string; kind: 'DigitalWorker' | 'APIProxy' | 'EventProducer' } | undefined>;
}

/** 由 release 模块提供：两个物理槽的当前角色。 */
export interface SlotRoles {
  slotRoles(serviceId: ServiceId): Promise<{ prod: 'blue' | 'green'; preview: 'blue' | 'green' } | undefined>;
}

/** 由 api-catalog 模块提供：调用方已获授权的操作键、默认开放集合、已登记的 proxy 名。 */
export interface GrantSource {
  grantedOperations(callerIdentity: string): Promise<{ operations: string[]; defaultOpen: string[] }>;
  listCallers(): Promise<string[]>;
  proxyNameOf(serviceId: ServiceId): Promise<string | undefined>;
}

export interface HostNaming {
  prodHost(projectSlug: string): string;
  previewHost(projectSlug: string): string;
  serviceHost(serviceName: string): string;
  platformApiHost(): string;
}
