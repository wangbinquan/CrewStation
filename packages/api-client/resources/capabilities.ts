import type { CapabilityDescriptionDto } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import { segment } from '../requestUrl';

/** 能力说明（R48）：与能力说明 MCP 同源的聚合视图。 */
export interface CapabilitiesResource {
  /** GET /v1/projects/:projectId/capabilities */
  describe(projectId: string): Promise<CapabilityDescriptionDto>;
}

export function capabilitiesResource(transport: Transport): CapabilitiesResource {
  return {
    describe: (projectId) => transport.request<CapabilityDescriptionDto>('GET', `/v1/projects/${segment(projectId)}/capabilities`),
  };
}
