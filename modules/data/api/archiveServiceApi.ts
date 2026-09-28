import type { ArchivePlanDto, ArchivePlanEntriesDto, ArchivePlanEntriesQuery, ArchivePlanPage, CreateArchivePlan, FinalizationArchive, SealArchivePlan, TaskId } from '@crewstation/contracts';
import type { ObjectServiceCaller } from './objectServiceApi';

export interface ArchiveServiceApi {
  preflight(caller: ObjectServiceCaller, taskId: TaskId, archive: FinalizationArchive): Promise<{ spaceId: string }>;
  create(caller: ObjectServiceCaller, taskId: TaskId, input: CreateArchivePlan): Promise<ArchivePlanDto>;
  get(caller: ObjectServiceCaller, id: string): Promise<ArchivePlanDto>;
  entries(caller: ObjectServiceCaller, id: string, query: ArchivePlanEntriesQuery): Promise<ArchivePlanEntriesDto>;
  append(caller: ObjectServiceCaller, id: string, input: ArchivePlanPage): Promise<ArchivePlanDto>;
  seal(caller: ObjectServiceCaller, id: string, input: SealArchivePlan): Promise<ArchivePlanDto>;
  abort(caller: ObjectServiceCaller, id: string, input: SealArchivePlan): Promise<ArchivePlanDto>;
}
