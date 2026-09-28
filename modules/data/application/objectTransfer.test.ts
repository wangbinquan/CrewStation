import { expect, test } from 'bun:test';
import { precondition } from '@crewstation/kernel';
import { objectDownloadStream } from './objectTransfer';
import type { ObjectContentRepository } from '../ports/objectContent';
import type { StoredObjectRecord } from '../domain/objectStorage';

test('an abandoned response still releases a finished backend read and records integrity failures', async () => {
  for (const result of ['valid', 'mismatch', 'rejected']) {
    let degraded = false; const released = Promise.withResolvers<void>(), completed = Promise.withResolvers<{ size: number; sha256: string }>();
    const content = { releaseRead: async () => { released.resolve(); return true; }, markDegraded: async () => { degraded = true; } } as unknown as ObjectContentRepository;
    const body = new ReadableStream<Uint8Array>({});
    const response = objectDownloadStream({ content }, { id: 'object', size: 1, sha256: 'a'.repeat(64) } as StoredObjectRecord, { id: 'read', owner: 'pod' }, { body, size: 1, completed: completed.promise }, new AbortController().signal);
    if (result === 'rejected') completed.reject(precondition('bad bytes', { code: 'object_digest_mismatch' }));
    else completed.resolve({ size: 1, sha256: result === 'valid' ? 'a'.repeat(64) : 'b'.repeat(64) });
    await released.promise;
    expect(degraded).toBe(result !== 'valid'); await response.cancel().catch(() => undefined);
  }
});
