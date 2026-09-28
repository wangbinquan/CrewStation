import type { ArchiveHelperFailure, ArchiveHelperResult, ArchiveHelperUpload, ArchivePlanEntry, ObjectUploadDto } from '@crewstation/contracts';

export interface ArchiveHelperCaller { readonly id: string; readonly token: string; readonly podUid: string }
export interface ArchiveHelperApi {
  /** Private task-runtime port; helpers never receive this endpoint. */
  issue(input: { id: string; bindingId: string; revision: number; consumerId: string; expiresAt: string }): Promise<{ token: string }>;
  close(id: string): Promise<void>;
  bind(id: string, podUid: string): Promise<void>;
  entries(caller: ArchiveHelperCaller, offset: number, limit: number): Promise<{ items: readonly ArchivePlanEntry[]; nextOffset: number | null }>;
  upload(caller: ArchiveHelperCaller, input: ArchiveHelperUpload): Promise<ObjectUploadDto>;
  status(caller: ArchiveHelperCaller, uploadId: string): Promise<ObjectUploadDto>;
  content(caller: ArchiveHelperCaller, uploadId: string, input: { body: ReadableStream<Uint8Array>; length: number; signal: AbortSignal }): Promise<ObjectUploadDto>;
  commit(caller: ArchiveHelperCaller, uploadId: string): Promise<ObjectUploadDto>;
  result(caller: ArchiveHelperCaller, input: ArchiveHelperResult): Promise<void>;
  complete(caller: ArchiveHelperCaller): Promise<void>;
  fail(caller: ArchiveHelperCaller, input: ArchiveHelperFailure): Promise<void>;
}
