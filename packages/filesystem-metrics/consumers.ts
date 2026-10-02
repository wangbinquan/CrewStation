import { readdir, readFile, readlink, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface RetainedFileIdentity { readonly device: string; readonly inode: string }
export interface FileConsumer {
  readonly pid: number; readonly tid: number; readonly startedTick: string; readonly kind: 'descriptor' | 'mapping' | 'cwd' | 'root' | 'executable';
  readonly device: string; readonly inode: string;
}
export interface FileConsumerSnapshot {
  readonly version: 1; readonly complete: boolean; readonly bootId: string; readonly namespace: string;
  readonly consumers: readonly FileConsumer[];
  readonly blockers: readonly { readonly code: 'source-unreadable' | 'process-unreadable' | 'process-changed'; readonly pid?: number }[];
}
const identityKey = (device: string, inode: string) => `${device}:${inode}`;
const startTick = (value: string, id: string) => {
  const end = value.lastIndexOf(') '), tick = end < 0 ? undefined : value.slice(end + 2).trim().split(/\s+/)[19];
  if (!value.startsWith(`${id} (`) || !tick || !/^[0-9]+$/.test(tick)) throw new Error('Invalid process identity'); return tick;
};
const linuxDevice = (major: bigint, minor: bigint) => String((minor & 0xffn) | ((major & 0xfffn) << 8n) | ((minor & ~0xffn) << 12n) | ((major & ~0xfffn) << 32n));

/** Reads every thread in the visible process namespace; scope identity and producer closure must be verified separately. No file contents, arguments or environment are read. */
export async function observeFileConsumers(identities: readonly RetainedFileIdentity[], procRoot = '/proc', signal?: AbortSignal): Promise<FileConsumerSnapshot> {
  if (identities.some(({ device, inode }) => !/^[0-9]+$/.test(device) || !/^[1-9][0-9]*$/.test(inode))) throw new Error('Invalid retained file identity');
  const wanted = new Set(identities.map(({ device, inode }) => identityKey(device, inode)));
  const consumers: FileConsumer[] = [], blockers: { code: 'source-unreadable' | 'process-unreadable' | 'process-changed'; pid?: number }[] = [];
  let bootId = '', namespace = '';
  try {
    signal?.throwIfAborted(); bootId = (await readFile(join(procRoot, 'sys/kernel/random/boot_id'), 'utf8')).trim();
    namespace = await readlink(join(procRoot, 'self/ns/pid'));
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(bootId) || !/^pid:\[[0-9]+\]$/.test(namespace)) throw new Error('Invalid process source');
    const before = await processIds(procRoot);
    if (!before.length) throw new Error('Process namespace is empty');
    for (const id of before) {
      signal?.throwIfAborted();
      try { await inspectProcess(procRoot, id, wanted, consumers, signal); }
      catch (error) { if (signal?.aborted) throw error; blockers.push({ code: 'process-unreadable', pid: Number(id) }); }
    }
    if (JSON.stringify(before) !== JSON.stringify(await processIds(procRoot)) || bootId !== (await readFile(join(procRoot, 'sys/kernel/random/boot_id'), 'utf8')).trim()
      || namespace !== await readlink(join(procRoot, 'self/ns/pid'))) blockers.push({ code: 'process-changed' });
  } catch (error) { if (signal?.aborted) throw error; blockers.push({ code: 'source-unreadable' }); }
  return { version: 1, complete: blockers.length === 0, bootId, namespace, consumers, blockers };
}

const processIds = async (root: string) => (await readdir(root)).filter((id) => /^[1-9][0-9]*$/.test(id)).sort();
async function inspectProcess(root: string, id: string, wanted: ReadonlySet<string>, consumers: FileConsumer[], signal?: AbortSignal): Promise<void> {
  const directory = join(root, id), startedTick = startTick(await readFile(join(directory, 'stat'), 'utf8'), id);
  const before = await processIds(join(directory, 'task')), observed: FileConsumer[] = [];
  if (!before.includes(id)) throw new Error('Original process thread is unavailable');
  for (const tid of before) await inspectThread(join(directory, 'task', tid), id, tid, wanted, observed, signal);
  if (JSON.stringify(before) !== JSON.stringify(await processIds(join(directory, 'task')))
    || startedTick !== startTick(await readFile(join(directory, 'stat'), 'utf8'), id)) throw new Error('Original process changed');
  consumers.push(...observed);
}
async function inspectThread(directory: string, id: string, tid: string, wanted: ReadonlySet<string>, consumers: FileConsumer[], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted(); const startedTick = startTick(await readFile(join(directory, 'stat'), 'utf8'), tid);
  const found = new Map<string, FileConsumer>();
  const record = (kind: FileConsumer['kind'], device: string, inode: string) => {
    if (wanted.has(identityKey(device, inode))) found.set(`${kind}:${device}:${inode}`, { pid: Number(id), tid: Number(tid), startedTick, kind, device, inode });
  };
  const descriptors = await readdir(join(directory, 'fd'));
  if (descriptors.some((name) => !/^[0-9]+$/.test(name))) throw new Error('Unknown descriptor entry');
  const links: { name: string; kind: FileConsumer['kind'] }[] = descriptors.map((name) => ({ name: join('fd', name), kind: 'descriptor' }));
  for (const kind of ['cwd', 'root', 'executable'] as const) links.push({ name: kind === 'executable' ? 'exe' : kind, kind });
  for (const link of links) {
    signal?.throwIfAborted();
    try { const observed = await stat(join(directory, link.name), { bigint: true }); record(link.kind, String(observed.dev), String(observed.ino)); }
    catch (error) { if (!isMissing(error)) throw error; }
  }
  const maps = await readFile(join(directory, 'maps'), { encoding: 'utf8', signal });
  for (const line of maps.split('\n').filter(Boolean)) {
    signal?.throwIfAborted(); const match = /^[a-f0-9]+-[a-f0-9]+\s+[-rwxps]+\s+[a-f0-9]+\s+([a-f0-9]+):([a-f0-9]+)\s+([0-9]+)(?:\s|$)/i.exec(line);
    if (!match) throw new Error('Unknown mapping format');
    if (match[3] !== '0') record('mapping', linuxDevice(BigInt(`0x${match[1]}`), BigInt(`0x${match[2]}`)), match[3]!);
  }
  if (startedTick !== startTick(await readFile(join(directory, 'stat'), 'utf8'), tid)) throw new Error('Original thread changed');
  consumers.push(...found.values());
}
const isMissing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';
