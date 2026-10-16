import type { BusinessMaterialObjectScope as MaterialObjectScope } from '@crewstation/contracts';
import type { UploadAuthority } from '../objectStorage';
export const MATERIAL_REFERENCE_PREFIX = 'cs-execution-material:';
export interface MaterialObjectRepository {
  pin(input: MaterialObjectScope, authority: UploadAuthority): Promise<void>;
  check(input: MaterialObjectScope): Promise<void>;
}
