import { surfaceSchema } from './contractSurface';
import { CreateObjectUploadSchema, CommitObjectUploadSchema, DeleteStoredObjectSchema, ObjectReferenceSchema, ObjectPageQuerySchema } from '../api/object-storage/requests';
import { ObjectSpaceDtoSchema, StoredObjectDtoSchema, StoredObjectPageSchema, ObjectUploadDtoSchema } from '../api/object-storage/responses';
import { CreateArchivePlanSchema, ArchivePlanPageSchema, SealArchivePlanSchema, ArchivePlanDtoSchema, ArchivePlanEntriesQuerySchema, ArchivePlanEntriesDtoSchema } from '../api/object-storage/archivePlans';
import { FinalizeBusinessTaskSchema, ReviseBusinessArchiveSchema, BusinessFinalizationDtoSchema } from '../api/business/finalization';

/** Public service storage and completion contracts have the same compatibility gate as execution. */
export function objectStorageSurface() {
  const sent = { CreateObjectUpload: CreateObjectUploadSchema, CommitObjectUpload: CommitObjectUploadSchema, DeleteStoredObject: DeleteStoredObjectSchema,
    ObjectReference: ObjectReferenceSchema, ObjectPageQuery: ObjectPageQuerySchema, CreateArchivePlan: CreateArchivePlanSchema, ArchivePlanPage: ArchivePlanPageSchema,
    SealArchivePlan: SealArchivePlanSchema, ArchivePlanEntriesQuery: ArchivePlanEntriesQuerySchema, FinalizeBusinessTask: FinalizeBusinessTaskSchema, ReviseBusinessArchive: ReviseBusinessArchiveSchema };
  const received = { ObjectSpaceDto: ObjectSpaceDtoSchema, StoredObjectDto: StoredObjectDtoSchema, StoredObjectPage: StoredObjectPageSchema, ObjectUploadDto: ObjectUploadDtoSchema,
    ArchivePlanDto: ArchivePlanDtoSchema, ArchivePlanEntriesDto: ArchivePlanEntriesDtoSchema, BusinessFinalizationDto: BusinessFinalizationDtoSchema };
  return Object.fromEntries([
    ...Object.entries(sent).map(([name, schema]) => [name, surfaceSchema(schema, 'business-to-platform')]),
    ...Object.entries(received).map(([name, schema]) => [name, surfaceSchema(schema, 'platform-to-business')]),
  ]);
}
