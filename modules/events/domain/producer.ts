import type { ProjectId, ServiceId } from '@crewstation/contracts';

/** 登记的生产方：EventProducer 项目发布时按 Manifest `spec.producer` 登记，并记住服务身份供 produce 时核对。 */
export interface Producer {
  readonly producer: string;
  readonly serviceId: ServiceId;
  readonly projectId: ProjectId;
  readonly projectSlug: string;
  /** `<project>/<service>`；网关注入的 x-cs-source-service 必须与之一致。 */
  readonly serviceIdentity: string;
  readonly updatedAt: Date;
}

/** 目录中的事件类型；一个事件类型只能由一个生产方声明。 */
export interface EventType {
  readonly eventType: string;
  readonly producer: string;
  readonly producerProject: string;
  readonly schemaRef?: string;
}
