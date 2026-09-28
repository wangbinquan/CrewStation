import { ArchiveHelperEntriesSchema, OBJECT_STORAGE_LIMITS, ObjectUploadDtoSchema } from '@crewstation/contracts';
import type { ArchiveHelperFailure, ArchiveHelperResult, ArchiveHelperUpload, ObjectUploadDto } from '@crewstation/contracts';
export class ArchiveRequestError extends Error {
  constructor(readonly status: number, readonly retryAfterMs: number, message: string) { super(message); }
}
async function responseJson(response: Response, limit: number): Promise<unknown> {
  const reader = response.body?.getReader(); if (!reader) throw new Error('归档接口未返回响应');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > limit) { await reader.cancel(); throw new Error('归档接口响应超出上限'); } chunks.push(chunk.value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}

export function archiveClient(baseUrl: string, token: string, signal: AbortSignal, podUid: string) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || !/^\/internal\/archive-helpers\/[a-f0-9-]{36}$/.test(base.pathname)) throw new Error('归档接口地址无效');
  if (!/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new Error('归档凭证无效');
  if (!/^[a-f0-9-]{36}$/.test(podUid)) throw new Error('归档 Pod 身份无效');
  const request = async (path: string, options: { method?: string; json?: unknown; stream?: ReadableStream<Uint8Array>; size?: number } = {}) => {
    const timeout = options.stream ? OBJECT_STORAGE_LIMITS.transferSeconds * 1000 : 30_000;
    const response = await fetch(`${baseUrl}${path}`, { method: options.method ?? 'GET', signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]), redirect: 'error',
      headers: { authorization: `Bearer ${token}`, 'x-cs-archive-pod-uid': podUid, ...(options.json ? { 'content-type': 'application/json' } : {}), ...(options.size !== undefined ? { 'content-length': String(options.size) } : {}) },
      ...(options.stream ? { body: options.stream } : options.json ? { body: JSON.stringify(options.json) } : {}) });
    if (!response.ok) {
      // Error responses can include unrelated proxy output; never echo bodies or credentials into logs.
      await response.body?.cancel();
      const retry = Number(response.headers.get('retry-after') ?? '5');
      throw new ArchiveRequestError(response.status, Math.max(1000, Math.min(30_000, Number.isFinite(retry) ? retry * 1000 : 5000)), `归档请求暂未完成（HTTP ${response.status}）`);
    }
    return response.status === 204 ? undefined : responseJson(response, path.startsWith('/entries') ? OBJECT_STORAGE_LIMITS.pageBytes : 32_768);
  };
  return {
    entries: async (offset: number) => ArchiveHelperEntriesSchema.parse(await request(`/entries?offset=${offset}&limit=100`)),
    upload: async (input: ArchiveHelperUpload): Promise<ObjectUploadDto> => ObjectUploadDtoSchema.parse(await request('/uploads', { method: 'POST', json: input })),
    status: async (id: string) => ObjectUploadDtoSchema.parse(await request(`/uploads/${id}`)),
    content: async (id: string, body: ReadableStream<Uint8Array>, size: number) => ObjectUploadDtoSchema.parse(await request(`/uploads/${id}/content`, { method: 'PUT', stream: body, size })),
    commit: async (id: string) => ObjectUploadDtoSchema.parse(await request(`/uploads/${id}/commit`, { method: 'POST' })),
    result: async (input: ArchiveHelperResult) => { await request('/results', { method: 'POST', json: input }); },
    fail: async (input: ArchiveHelperFailure) => { await request('/failure', { method: 'POST', json: input }); },
    complete: async () => { await request('/complete', { method: 'POST' }); },
  };
}
export type ArchiveClient = ReturnType<typeof archiveClient>;
