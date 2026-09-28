import type { BusinessStorageFinalization } from '@crewstation/contracts';

/** Permanent task admission closure, serialized with environment creation, for tasks that never acquired an environment. */
export interface UnprovisionedStorage {
  freeze(input: BusinessStorageFinalization): Promise<boolean>;
  owns(input: BusinessStorageFinalization): Promise<boolean>;
  complete(input: BusinessStorageFinalization, proofId: string): Promise<void>;
}
