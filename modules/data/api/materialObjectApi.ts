import type { BusinessExecutionFence, BusinessMaterialDownload } from '@crewstation/contracts';
import type { ObjectServiceCaller, ObjectServiceApi } from './objectServiceApi';
import type { BusinessMaterialObjectScope as MaterialObjectScope } from '@crewstation/contracts';
export type { BusinessMaterialObjectScope as MaterialObjectScope } from '@crewstation/contracts';
/** Internal business-task capability. Download credentials authorize exactly one pinned immutable object. */
export interface MaterialObjectApi {
  pin(caller: ObjectServiceCaller, input: MaterialObjectScope & { fence?: BusinessExecutionFence; revision?: number }): Promise<void>;
  check(input: MaterialObjectScope): Promise<void>;
  /** Releases exactly one pin revision once business-task proves no live or retained attempt needs it. */
  release(input: MaterialObjectScope & { revision: number }): Promise<void>;
  grants(input: MaterialObjectScope): Promise<BusinessMaterialDownload[]>;
  download(objectId: string, token: string, signal: AbortSignal): ReturnType<ObjectServiceApi['download']>;
}
