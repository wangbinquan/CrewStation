import type { RuntimeImageArchitecture } from '@crewstation/contracts';
import type { RegistryRepositoryAccess } from '../domain/registryReference';
import type { InspectedImage } from '../domain/inspectedImage';
export type { InspectedImage } from '../domain/inspectedImage';
export interface RuntimeImageRegistry {
  inspect(reference: string, architecture: RuntimeImageArchitecture, access: RegistryRepositoryAccess): Promise<InspectedImage>;
}
