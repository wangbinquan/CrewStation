import { createHash } from 'node:crypto';
import { DevelopmentNativePageChunkSchema, DevelopmentNativePageEvidenceSchema,
  type DevelopmentNativePageEvidence, type DevelopmentUsageKey,
  type RunnerCommand, type TaskId } from '@crewstation/contracts';
import { conflict, jsonHash, newResourceId } from '@crewstation/kernel';

import { originalNativePage } from '../domain/developmentNativeEvidence';

export interface DevelopmentNativePageReader {
  send(taskId: TaskId, command: RunnerCommand): Promise<unknown>;
}
/** One original page at a time; all bytes to EOF precede any durable-copy or Runner acknowledgement. */
export async function readDevelopmentNativePage(deps: DevelopmentNativePageReader, taskId: TaskId,
  key: DevelopmentUsageKey, passId: string, ordinal: string): Promise<DevelopmentNativePageEvidence> {
  const chunks: Buffer[] = []; let afterByte = 0;
  let original: Omit<ReturnType<typeof DevelopmentNativePageChunkSchema.parse>, 'document'> | undefined;
  let digest: string | undefined, totalBytes: number | undefined;
  for (;;) {
    const packet = DevelopmentNativePageChunkSchema.parse(await deps.send(taskId, {
      id: newResourceId(), type: 'readDevelopmentNativePage', key, passId, ordinal, afterByte,
    }));
    const { document, ...metadata } = packet;
    if (taskId !== key.executionId || jsonHash(packet.key) !== jsonHash(key) ||
        packet.ack.identity.passId !== passId || packet.ack.ordinal !== ordinal || document.afterByte !== afterByte ||
        (original && (jsonHash(original) !== jsonHash(metadata) || digest !== document.digest || totalBytes !== document.totalBytes)))
      throw conflict('原页读取不能换键、换页、跳字节或替换冻结证据');
    original ??= metadata; digest ??= document.digest; totalBytes ??= document.totalBytes;
    chunks.push(Buffer.from(document.chunk, 'base64')); afterByte = document.throughByte;
    if (document.eof) break;
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== totalBytes || createHash('sha256').update(bytes).digest('hex') !== digest)
    throw conflict('原页字节副本与实际文档摘要不符');
  const document = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const evidence = DevelopmentNativePageEvidenceSchema.parse({ ...original, document });
  originalNativePage(evidence);
  return evidence;
}
