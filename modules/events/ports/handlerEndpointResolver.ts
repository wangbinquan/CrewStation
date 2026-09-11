import type { ServiceId } from '@crewstation/contracts';

export interface HandlerEndpoint {
  /** 订阅方 active prod 槽的服务域地址，形如 `http://<slug>.<serviceDomain>`；推送经网关，由网关注入来源令牌。 */
  readonly baseUrl: string;
}

/** 订阅方当前 active 槽在哪里：由 release 模块的查询经应用装配提供；没有 active 槽时返回 undefined，投递稍后重试。 */
export interface HandlerEndpointResolver {
  resolve(serviceId: ServiceId): Promise<HandlerEndpoint | undefined>;
}
