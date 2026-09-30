import type { Clock } from '@crewstation/kernel';
import type { ResourceAccessRepository } from '../ports/repository';
import type { ResourceAdapter, ResourceProjectAccess } from '../ports/resources';

export interface ResourceAccessDeps { repository: ResourceAccessRepository; projects: ResourceProjectAccess; adapters: readonly ResourceAdapter[]; clock: Clock }
