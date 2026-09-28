import type { BusinessExecutionFence, CommitObjectUpload, CreateObjectUpload, DeleteStoredObject, ObjectPageQuery, ObjectReferenceInput, ObjectSpaceDto, ObjectUploadDto, StoredObjectDto, StoredObjectPage } from '@crewstation/contracts';

export interface ObjectServiceCaller { readonly identity: string; readonly token?: string }
export interface ObjectServiceApi {
  space(caller: ObjectServiceCaller): Promise<ObjectSpaceDto>;
  upload(caller: ObjectServiceCaller, input: CreateObjectUpload): Promise<ObjectUploadDto>;
  uploadStatus(caller: ObjectServiceCaller, id: string): Promise<ObjectUploadDto>;
  content(caller: ObjectServiceCaller, id: string, input: { body: ReadableStream<Uint8Array>; length: number; signal: AbortSignal; fence?: BusinessExecutionFence }): Promise<ObjectUploadDto>;
  commit(caller: ObjectServiceCaller, id: string, input: CommitObjectUpload): Promise<ObjectUploadDto>;
  list(caller: ObjectServiceCaller, input: ObjectPageQuery): Promise<StoredObjectPage>;
  get(caller: ObjectServiceCaller, id: string): Promise<StoredObjectDto>;
  download(caller: ObjectServiceCaller, id: string, input: { signal: AbortSignal; range?: string }): Promise<{ object: StoredObjectDto; body: ReadableStream<Uint8Array>; size: number; contentRange?: string }>;
  reference(caller: ObjectServiceCaller, id: string, input: ObjectReferenceInput, desired: 'active' | 'released'): Promise<StoredObjectDto>;
  delete(caller: ObjectServiceCaller, id: string, input: DeleteStoredObject): Promise<StoredObjectDto>;
}
