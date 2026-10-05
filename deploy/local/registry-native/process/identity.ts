import { createHash } from 'node:crypto';
import { readdir, readFile, readlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { consumerMetadata } from '../../../../packages/filesystem-metrics/consumerMetadata';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const RegistryProcessIdentitySchema = z.strictObject({ pid: z.number().int().positive(), containerId: z.string().regex(/^containerd:\/\/[a-f0-9]{64}$/), podUid: z.uuid(),
  bootId: z.uuid(), namespace: z.string().regex(/^pid:\[[1-9][0-9]*\]$/), startTicks: z.string().regex(/^[1-9][0-9]*$/), cgroup: z.string().regex(/^[a-f0-9]{64}$/),
  executable: z.literal('/bin/registry'), executableIdentity: z.string().regex(/^[a-f0-9]{64}$/) });
export type RegistryProcessIdentity = z.infer<typeof RegistryProcessIdentitySchema>;
export function processStat(value: string, id: string) {
  const end = value.lastIndexOf(') '), fields = value.slice(end + 2).trim().split(/\s+/);
  if (!value.startsWith(id + ' (') || end < 0 || !/^[1-9][0-9]*$/.test(fields[19] ?? '') || !/^[A-Za-z]$/.test(fields[0] ?? '')) throw Error('Original Registry process stat is unsupported');
  return { state: fields[0]!, startTicks: fields[19]! };
}
const ids = async (directory: string) => (await readdir(directory)).filter(value => /^[1-9][0-9]*$/.test(value)).sort();
const executableSource = async (directory: string) => ({ name: await readlink(join(directory, 'exe')), file: await stat(join(directory, 'exe'), { bigint: true }) });
/** Deployment-only input. Every visible process is examined; a matching name
 * or a caller-provided PID cannot select the original Registry process. */
export async function inspectOriginalRegistryProcess(input: Pick<RegistryProcessIdentity, 'containerId' | 'podUid'>, procRoot = '/proc', signal?: AbortSignal, readExecutable: typeof executableSource = executableSource) {
  const metadata = consumerMetadata(procRoot), activeSignal = signal ?? AbortSignal.timeout(10_000);
  const cid = z.string().regex(/^containerd:\/\/[a-f0-9]{64}$/).parse(input.containerId).slice(13), uid = z.uuid().parse(input.podUid).replaceAll('-', '_');
  const bootId = (await metadata.read(join(procRoot, 'sys/kernel/random/boot_id'), activeSignal)).trim(), namespace = await metadata.link(join(procRoot, 'self/ns/pid'));
  const before = (await metadata.entries(procRoot)).filter(value => /^[1-9][0-9]*$/.test(value)).sort(), matches: RegistryProcessIdentity[] = [];
  if (!before.length || before.length > 100_000) throw Error('Original Registry process namespace is unavailable');
  for (const id of before) {
    await metadata.checkpoint(activeSignal); const directory = join(procRoot, id), cgroup = await metadata.read(join(directory, 'cgroup'), activeSignal);
    const lines = cgroup.trimEnd().split('\n');
    if (!lines.some(line => line.endsWith('/cri-containerd-' + cid + '.scope'))) continue;
    if (lines.length !== 1 || !lines[0]!.startsWith('0::/') || !lines[0]!.includes('pod' + uid + '.slice/')) throw Error('Original Registry cgroup is unsupported');
    const original = processStat(await metadata.read(join(directory, 'stat'), activeSignal), id), { name: executable, file } = await readExecutable(directory);
    if (executable !== '/bin/registry' || !file.isFile() || file.birthtimeNs <= 0n) throw Error('Original Registry executable is unsupported');
    const identity = RegistryProcessIdentitySchema.parse({ pid: Number(id), ...input, bootId, namespace, startTicks: original.startTicks, cgroup: hash(cgroup), executable,
      executableIdentity: hash([String(file.dev), String(file.ino), String(file.birthtimeNs)]) });
    if (original.startTicks !== processStat(await metadata.read(join(directory, 'stat'), activeSignal), id).startTicks || cgroup !== await metadata.read(join(directory, 'cgroup'), activeSignal)) throw Error('Original Registry process changed during capture');
    matches.push(identity);
  }
  if (matches.length !== 1 || JSON.stringify(before) !== JSON.stringify((await metadata.entries(procRoot)).filter(value => /^[1-9][0-9]*$/.test(value)).sort()) || bootId !== (await metadata.read(join(procRoot, 'sys/kernel/random/boot_id'), activeSignal)).trim()
    || namespace !== await metadata.link(join(procRoot, 'self/ns/pid'))) throw Error('Original Registry process namespace changed or has an additional producer');
  return matches[0]!;
}
/** The held pidfd and all-thread stop fence bind this one original producer.
 * Revalidate its actual kernel, executable, cgroup and PID birth at every
 * unlink; complete host capture still precedes each exclusive pause. */
export async function revalidateOriginalRegistryProcess(original: RegistryProcessIdentity, procRoot = '/proc', signal = AbortSignal.timeout(10_000), readExecutable: typeof executableSource = executableSource) {
  const metadata = consumerMetadata(procRoot), directory = join(procRoot, String(original.pid)), id = String(original.pid);
  const before = processStat(await metadata.read(join(directory, 'stat'), signal), id), cgroup = await metadata.read(join(directory, 'cgroup'), signal);
  const { name, file } = await readExecutable(directory);
  const actual = RegistryProcessIdentitySchema.parse({ ...original, bootId: (await metadata.read(join(procRoot, 'sys/kernel/random/boot_id'), signal)).trim(), namespace: await metadata.link(join(procRoot, 'self/ns/pid')),
    startTicks: before.startTicks, cgroup: hash(cgroup), executable: name, executableIdentity: hash([String(file.dev), String(file.ino), String(file.birthtimeNs)]) });
  if (hash(actual) !== hash(original) || before.startTicks !== processStat(await metadata.read(join(directory, 'stat'), signal), id).startTicks
    || cgroup !== await metadata.read(join(directory, 'cgroup'), signal)) throw Error('Original held Registry producer changed');
  signal.throwIfAborted(); return actual;
}
export async function assertRegistryThreadsStopped(original: RegistryProcessIdentity, procRoot = '/proc', signal?: AbortSignal) {
  const directory = join(procRoot, String(original.pid)), before = await ids(join(directory, 'task'));
  if (!before.includes(String(original.pid))) throw Error('Original Registry main thread is absent');
  for (const id of before) {
    signal?.throwIfAborted(); const thread = processStat(await readFile(join(directory, 'task', id, 'stat'), 'utf8'), id);
    if (thread.state !== 'T') throw Error('Original Registry thread has not stopped');
  }
  if (JSON.stringify(before) !== JSON.stringify(await ids(join(directory, 'task'))) || processStat(await readFile(join(directory, 'stat'), 'utf8'), String(original.pid)).startTicks !== original.startTicks) throw Error('Original Registry stopped threads changed');
}
