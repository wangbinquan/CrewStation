import type { ProjectServiceActor } from '@crewstation/contracts';

/** 固定受众验签与原工作负载归属，由 identity 经平台组合根提供。 */
export interface EventIngressSource {
  resolve(caller: { identity: string; token?: string }): Promise<ProjectServiceActor | undefined>;
}
