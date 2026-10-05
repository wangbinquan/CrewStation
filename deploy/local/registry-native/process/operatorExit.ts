import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { jsonHash } from '../../../../packages/kernel';
import { processStat } from './identity';

export const RegistryOperatorBirthSchema = z.strictObject({ bootId: z.string().uuid(), namespace: z.string().regex(/^[1-9][0-9]*$/), pid: z.number().int().positive(), startTicks: z.string().regex(/^[1-9][0-9]*$/) });
export type RegistryOperatorBirth = z.infer<typeof RegistryOperatorBirthSchema>;
async function source(root: string) {
  const bootId = (await readFile(root + '/sys/kernel/random/boot_id', 'utf8')).trim(), link = await import('node:fs/promises').then(fs => fs.readlink(root + '/self/ns/pid'));
  const namespace = /^pid:\[([1-9][0-9]*)\]$/.exec(link)?.[1]; if (!namespace) throw Error('Original Registry operator PID namespace is unavailable');
  return { bootId, namespace };
}
export async function captureRegistryOperatorBirth(root = '/proc', pid = process.pid) {
  const before = await source(root), stat = processStat(await readFile(root + '/' + pid + '/stat', 'utf8'), String(pid)), after = await source(root);
  if (jsonHash(before) !== jsonHash(after)) throw Error('Original Registry operator source changed');
  return RegistryOperatorBirthSchema.parse({ ...before, pid, startTicks: stat.startTicks });
}
/** Kernel birth/source only. A deadline, dropped HTTP connection, journal
 * reopen or new operator never supplies an original process exit receipt. */
export async function proveRegistryOperatorExit(raw: RegistryOperatorBirth, root = '/proc') {
  const original = RegistryOperatorBirthSchema.parse(raw), before = await source(root);
  if (before.bootId !== original.bootId || before.namespace !== original.namespace) throw Error('Original Registry operator kernel source changed');
  let observed: string;
  try {
    const current = processStat(await readFile(root + '/' + original.pid + '/stat', 'utf8'), String(original.pid));
    if (current.startTicks === original.startTicks) return undefined; observed = jsonHash({ replacementPidBirth: current.startTicks });
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    observed = jsonHash({ originalPidAbsent: original.pid });
  }
  if (jsonHash(await source(root)) !== jsonHash(before)) throw Error('Original Registry operator source changed during exit observation');
  return jsonHash({ original, observed, source: before });
}
