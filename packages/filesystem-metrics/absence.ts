import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';

export const AbsenceRequestSchema = z.strictObject({ key: z.string().min(1).max(200), rootId: z.string().min(1).max(50), directory: z.string().regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,252}$/) });
export const AbsenceResponseSchema = z.strictObject({ key: z.string(), absent: z.boolean(), observedAt: z.string().datetime() });
/** Only a missing direct child under an existing, unchanged root is proof. EACCES/missing root/symlink is never absence. */
export async function directoryAbsent(root: string, directory: string): Promise<boolean> {
  AbsenceRequestSchema.parse({ key: 'check', rootId: 'root', directory });
  if (!isAbsolute(root)) throw new Error('Invalid root');
  const fd = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const before = await fd.stat({ bigint: true });
    let absent = false;
    try { await lstat(join(process.platform === 'linux' ? `/proc/self/fd/${fd.fd}` : root, directory)); }
    catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; absent = true; }
    const after = await lstat(root, { bigint: true });
    if (!after.isDirectory() || before.dev !== after.dev || before.ino !== after.ino) throw new Error('Root changed during observation');
    return absent;
  } finally { await fd.close(); }
}
