import type { Actor, CapabilityDescriptionDto, ProjectId } from '@crewstation/contracts';

export interface CapabilitiesModuleApi {
  readonly name: 'capabilities';
  describe(actor: Actor, projectId: ProjectId): Promise<CapabilityDescriptionDto>;
}
