import { setTimeout } from 'node:timers/promises';
import type { ArchivePlanEntry } from '@crewstation/contracts';
import { OBJECT_STORAGE_LIMITS } from '@crewstation/contracts';
import type { ArchiveClient } from './client';
import { ArchiveFileError } from './failure';
import { ArchiveRequestError } from './client';
import { describeArchiveFile, MissingArchiveFile, openArchiveFile } from './secureFile';

const pause = (ms: number, signal: AbortSignal) => setTimeout(ms, undefined, { signal });
async function retry<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    signal.throwIfAborted();
    try { return await work(); }
    catch (error) {
      if (attempt >= 6 || !(error instanceof ArchiveRequestError) || (error.status !== 429 && error.status < 500)) throw error;
      await pause(error.retryAfterMs, signal);
    }
  }
}
async function archiveFile(client: ArchiveClient, entry: Extract<ArchivePlanEntry, { kind: 'file' }>, root: string, signal: AbortSignal) {
  let file;
  try { file = await openArchiveFile(root, entry.path); }
  catch (error) {
    if (error instanceof MissingArchiveFile && !entry.required) { await retry(() => client.result({ path: entry.path, omitted: 'not-found' }), signal); return; }
    throw error;
  }
  try {
    const source = await describeArchiveFile(file);
    if (entry.expectedSize !== undefined && entry.expectedSize !== source.size) throw new ArchiveFileError('archive_file_size_mismatch', '文件长度与封存清单不符');
    let upload = await retry(() => client.upload({ path: entry.path, size: source.size, sha256: source.sha256 }), signal), pollMs = 100;
    while (upload.state !== 'ready') {
      signal.throwIfAborted(); await source.stable();
      if (upload.state === 'aborted' || upload.state === 'failed' && !upload.retryable) throw new ArchiveFileError('archive_upload_blocked', `文件上传已阻塞：${upload.errorCode ?? upload.state}`);
      if (upload.state === 'waiting' || upload.state === 'failed') {
        try { upload = await client.content(upload.id, source.stream(), source.size); }
        catch (error) {
          if (error instanceof ArchiveRequestError && ![409, 429].includes(error.status) && error.status < 500) throw error;
          // A lost PUT reply is ambiguous. Read the durable operation before attempting another body.
          await pause(5000, signal); upload = await retry(() => client.status(upload.id), signal); continue;
        }
      }
      if (upload.state === 'verifying') await retry(() => client.commit(upload.id), signal);
      await pause(pollMs, signal); upload = await retry(() => client.status(upload.id), signal); pollMs = Math.min(1000, pollMs * 2);
    }
    await source.stable();
    if (!upload.objectId) throw new Error('对象尚无验证回执');
    await retry(() => client.result({ path: entry.path, objectId: upload.objectId! }), signal);
  } finally { await file.close(); }
}

export async function executeArchive(client: ArchiveClient, root: string, signal: AbortSignal): Promise<number> {
  let offset = 0, count = 0;
  while (true) {
    const page = await retry(() => client.entries(offset), signal);
    count += await archivePage(client, page.items, root, signal);
    if (page.nextOffset === null) { await retry(client.complete, signal); return count; }
    if (page.nextOffset <= offset || !page.items.length) throw new Error('归档分页没有前进');
    offset = page.nextOffset;
  }
}

/** Bound open files/transfers, stop scheduling on failure, and settle active work before reporting it. */
async function archivePage(client: ArchiveClient, entries: ArchivePlanEntry[], root: string, signal: AbortSignal): Promise<number> {
  const files = entries.filter((entry): entry is Extract<ArchivePlanEntry, { kind: 'file' }> => entry.kind === 'file');
  let index = 0, completed = 0, failure: { path: string; error: unknown } | undefined;
  await Promise.all(Array.from({ length: Math.min(OBJECT_STORAGE_LIMITS.transfers, files.length) }, async () => {
    while (!failure && index < files.length) {
      const entry = files[index++]!;
      try { await archiveFile(client, entry, root, signal); completed++; }
      catch (error) { failure ??= { path: entry.path, error }; }
    }
  }));
  if (failure) {
    const { error, path } = failure;
    await client.fail({ path, code: error instanceof ArchiveFileError ? error.code : 'archive_transfer_failed' }).catch(() => undefined);
    throw error;
  }
  return completed;
}
