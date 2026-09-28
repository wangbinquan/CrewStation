import { OBJECT_STORAGE_LIMITS } from '@crewstation/contracts';
import type {
  ArchivePlanDto, ArchivePlanEntriesDto, ArchivePlanEntriesQuery, ArchivePlanPage, BusinessExecutionFence,
  CommitObjectUpload, CreateArchivePlan, CreateObjectUpload, DeleteStoredObject, ObjectPageQuery,
  ObjectReferenceInput, ObjectSpaceDto, ObjectUploadDto, SealArchivePlan, StoredObjectDto, StoredObjectPage,
} from '@crewstation/contracts';
import { errorFromResponse, networkError } from './apiClientError';
import { createTransport, type TransportOptions } from './httpTransport';
import { buildUrl } from './requestUrl';

export interface ObjectContentUpload {
  body: ReadableStream<Uint8Array>; length: number; signal?: AbortSignal; fence?: BusinessExecutionFence;
}
/** Service-domain metadata and streaming bytes. No automatic PUT replay after an ambiguous response. */
export function createServiceStorageClient(options: TransportOptions) {
  const transport = createTransport(options), root = '/v3/objects';
  const resource = (id: string) => `${root}/${encodeURIComponent(id)}`, upload = (id: string) => `${root}/uploads/${encodeURIComponent(id)}`;
  const plan = (id: string) => `${root}/archive-plans/${encodeURIComponent(id)}`;
  return {
    space: () => transport.request<ObjectSpaceDto>('GET', `${root}/space`),
    createUpload: (body: CreateObjectUpload) => transport.request<ObjectUploadDto>('POST', `${root}/uploads`, { body }),
    upload: (id: string) => transport.request<ObjectUploadDto>('GET', upload(id)),
    commit: (id: string, body: CommitObjectUpload) => transport.request<ObjectUploadDto>('POST', `${upload(id)}/commit`, { body }),
    uploadContent: async (id: string, input: ObjectContentUpload): Promise<ObjectUploadDto> => {
      if (!Number.isSafeInteger(input.length) || input.length < 0 || input.length > OBJECT_STORAGE_LIMITS.objectBytes) throw new Error('Object length is outside the supported limit');
      const response = await bytes(options, `${upload(id)}/content`, { method: 'PUT', body: input.body, signal: input.signal,
        headers: { 'content-type': 'application/octet-stream', 'content-length': String(input.length), ...(input.fence ? { 'x-cs-object-fence': JSON.stringify(input.fence) } : {}) } });
      return response.json() as Promise<ObjectUploadDto>;
    },
    list: (query: Partial<ObjectPageQuery> = {}) => transport.request<StoredObjectPage>('GET', root, { query }),
    get: (id: string) => transport.request<StoredObjectDto>('GET', resource(id)),
    download: (id: string, input: { range?: string; signal?: AbortSignal } = {}) => bytes(options, `${resource(id)}/content`, { method: 'GET', signal: input.signal, headers: input.range ? { range: input.range } : {} }),
    pin: (id: string, body: ObjectReferenceInput) => transport.request<StoredObjectDto>('PUT', `${resource(id)}/references`, { body }),
    unpin: (id: string, body: ObjectReferenceInput) => transport.request<StoredObjectDto>('DELETE', `${resource(id)}/references`, { body }),
    delete: (id: string, body: DeleteStoredObject) => transport.request<StoredObjectDto>('DELETE', resource(id), { body }),
    createPlan: (taskId: string, body: CreateArchivePlan) => transport.request<ArchivePlanDto>('POST', `${root}/tasks/${encodeURIComponent(taskId)}/archive-plans`, { body }),
    plan: (id: string) => transport.request<ArchivePlanDto>('GET', plan(id)),
    planEntries: (id: string, query: ArchivePlanEntriesQuery) => transport.request<ArchivePlanEntriesDto>('GET', `${plan(id)}/entries`, { query }),
    appendPlan: (id: string, body: ArchivePlanPage) => transport.request<ArchivePlanDto>('POST', `${plan(id)}/pages`, { body }),
    sealPlan: (id: string, body: SealArchivePlan) => transport.request<ArchivePlanDto>('POST', `${plan(id)}/seal`, { body }),
    abortPlan: (id: string, body: SealArchivePlan) => transport.request<ArchivePlanDto>('POST', `${plan(id)}/abort`, { body }),
  };
}
export type ServiceStorageClient = ReturnType<typeof createServiceStorageClient>;

async function bytes(options: TransportOptions, path: string, input: { method: 'GET' | 'PUT'; body?: ReadableStream<Uint8Array>; signal?: AbortSignal; headers: Record<string, string> }): Promise<Response> {
  const signal = AbortSignal.any([AbortSignal.timeout(OBJECT_STORAGE_LIMITS.transferSeconds * 1000), ...(input.signal ? [input.signal] : [])]);
  const headers = new Headers(options.headers);
  for (const [name, value] of Object.entries(input.headers)) headers.set(name, value);
  // Node fetch requires duplex for streamed uploads; Bun accepts the same option.
  const request: RequestInit & { duplex?: 'half' } = { method: input.method, headers, signal, credentials: 'include', redirect: 'error', ...(input.body ? { body: input.body, duplex: 'half' } : {}) };
  let response: Response;
  try { response = await (options.fetch ?? fetch)(buildUrl(options.baseUrl ?? '', path), request); } catch (cause) { throw networkError(cause); }
  if (!response.ok) { let payload: unknown; try { payload = await response.json(); } catch { payload = undefined; } throw errorFromResponse(response.status, payload, response.headers); }
  return response;
}
