import { createHash } from 'node:crypto';
import { DEVELOPMENT_NATIVE_PAGE_CHUNK_BYTES, DevelopmentNativePageChunkSchema,
  type DevelopmentNativePageChunk, type DevelopmentUsageKey } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';
import type { DevelopmentUsageJournal } from './developmentUsageJournal';

/** Reads one bounded byte chunk from the already committed original page; no watermark changes. */
export function readDevelopmentNativePage(journal: DevelopmentUsageJournal, key: DevelopmentUsageKey,
  passId: string, ordinal: string, afterByte: number): DevelopmentNativePageChunk {
  const evidence = journal.nativePage(key, passId, ordinal);
  const bytes = Buffer.from(evidence.document, 'utf8');
  if (!Number.isSafeInteger(afterByte) || afterByte < 0 || afterByte > bytes.length)
    throw new RunnerCommandError('development_native_page_range', '原页读取字节范围无效');
  const throughByte = Math.min(bytes.length, afterByte + DEVELOPMENT_NATIVE_PAGE_CHUNK_BYTES);
  const { document: _document, ...original } = evidence;
  return DevelopmentNativePageChunkSchema.parse({ version: 2, ...original, document: {
    digest: createHash('sha256').update(bytes).digest('hex'), afterByte, throughByte, totalBytes: bytes.length,
    chunk: bytes.subarray(afterByte, throughByte).toString('base64'), eof: throughByte === bytes.length,
  } });
}
