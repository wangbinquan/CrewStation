import type { ServiceId } from '@crewstation/contracts';

/** 由 gateway 模块经装配提供（RFC-021）：订阅方正式版本维护中且事件开关打开时，投递暂存、不算尝试。直接读库。 */
export interface DeliveryHold {
  holds(serviceId: ServiceId): Promise<boolean>;
}
