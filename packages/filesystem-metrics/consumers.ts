import { join } from 'node:path';
import { nativeConsumerTables } from './consumerTables';
import { consumerMetadata } from './consumerMetadata';
type Metadata = ReturnType<typeof consumerMetadata>;

export interface RetainedFileIdentity { readonly device: string; readonly inode: string }
export interface FileConsumer {
  readonly pid: number; readonly tid: number; readonly startedTick: string; readonly kind: 'descriptor' | 'mapping' | 'cwd' | 'root' | 'executable';
  readonly device: string; readonly inode: string;
}
export interface FileConsumerSnapshot {
  readonly version: 1; readonly complete: boolean; readonly bootId: string; readonly namespace: string;
  readonly consumers: readonly FileConsumer[];
  readonly blockers: readonly { readonly code: 'source-unreadable' | 'source-changed' | 'process-unreadable' | 'process-changed'; readonly pid?: number }[];
}
class ChangedConsumerError extends Error {}
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
  const tables = nativeConsumerTables(procRoot), metadata = consumerMetadata(procRoot);
  let bootId = '', namespace = '';
  try {
    signal?.throwIfAborted(); bootId = (await metadata.read(join(procRoot, 'sys/kernel/random/boot_id'), signal)).trim();
    namespace = await metadata.link(join(procRoot, 'self/ns/pid'));
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(bootId) || !/^pid:\[[0-9]+\]$/.test(namespace)) throw new Error('Invalid process source');
    const before = await processIds(procRoot, metadata);
    if (!before.length) throw new Error('Process namespace is empty');
    for (const id of before) {
      signal?.throwIfAborted();
      try { await metadata.checkpoint(signal); await inspectProcess(procRoot, id, wanted, consumers, metadata, signal, tables); }
      catch (error) { if (signal?.aborted) throw error; blockers.push({ code: error instanceof ChangedConsumerError ? 'process-changed' : 'process-unreadable', pid: Number(id) }); }
    }
    if (JSON.stringify(before) !== JSON.stringify(await processIds(procRoot, metadata)) || bootId !== (await metadata.read(join(procRoot, 'sys/kernel/random/boot_id'), signal)).trim()
      || namespace !== await metadata.link(join(procRoot, 'self/ns/pid'))) blockers.push({ code: 'process-changed' });
    signal?.throwIfAborted();
  } catch (error) { if (signal?.aborted) throw error; blockers.push({ code: 'source-unreadable' }); }
  finally { tables?.close(); }
  return { version: 1, complete: blockers.length === 0, bootId, namespace, consumers, blockers };
}

const processIds = async (root: string, metadata: Metadata) => (await metadata.entries(root)).filter((id) => /^[1-9][0-9]*$/.test(id)).sort();
async function inspectProcess(root: string, id: string, wanted: ReadonlySet<string>, consumers: FileConsumer[], metadata: Metadata, signal?: AbortSignal, tables?: ReturnType<typeof nativeConsumerTables>): Promise<void> {
  const directory = join(root, id), startedTick = startTick(await metadata.read(join(directory, 'stat'), signal), id);
  const before = await processIds(join(directory, 'task'), metadata), observed: FileConsumer[] = [];
  // Linux CLONE_THREAD requires CLONE_SIGHAND and CLONE_VM. Only the actual
  // /proc mount uses that kernel guarantee: inspect its shared address space
  // twice per process, while retaining every thread's separate FD/cwd table.
  // https://man7.org/linux/man-pages/man2/clone.2.html
  const sharedMaps = process.platform === 'linux' && root === '/proc';
  const mappings = sharedMaps ? await mappingReferences(directory, id, id, startedTick, wanted, metadata, signal) : [];
  if (!before.includes(id)) throw new Error('Original process thread is unavailable');
  const references = sharedMaps ? await retainedReferences(join(directory, 'task', id), id, id, startedTick, wanted, metadata, signal, false) : [];
  for (const tid of before) {
    await metadata.checkpoint(signal);
    const shared = tid !== id ? tables?.shared(id, tid) : undefined;
    await inspectThread(join(directory, 'task', tid), id, tid, wanted, observed, metadata, signal, !sharedMaps, shared);
    if (shared && JSON.stringify(shared) !== JSON.stringify(tables!.shared(id, tid))) throw new ChangedConsumerError('Original thread sharing changed');
  }
  if (JSON.stringify(before) !== JSON.stringify(await processIds(join(directory, 'task'), metadata))
    || startedTick !== startTick(await metadata.read(join(directory, 'stat'), signal), id)) throw new ChangedConsumerError('Original process changed');
  if (sharedMaps && JSON.stringify(mappings) !== JSON.stringify(await mappingReferences(directory, id, id, startedTick, wanted, metadata, signal))) throw new ChangedConsumerError('Original shared mappings changed');
  if (sharedMaps && JSON.stringify(references) !== JSON.stringify(await retainedReferences(join(directory, 'task', id), id, id, startedTick, wanted, metadata, signal, false))) throw new ChangedConsumerError('Original shared references changed');
  consumers.push(...observed, ...mappings);
}
async function inspectThread(directory: string, id: string, tid: string, wanted: ReadonlySet<string>, consumers: FileConsumer[], metadata: Metadata, signal?: AbortSignal, mappings = true, shared?: { files: boolean; fs: boolean }): Promise<void> {
  signal?.throwIfAborted(); const startedTick = startTick(await metadata.read(join(directory, 'stat'), signal), tid);
  const before = await retainedReferences(directory, id, tid, startedTick, wanted, metadata, signal, mappings, shared);
  const after = await retainedReferences(directory, id, tid, startedTick, wanted, metadata, signal, mappings, shared);
  const keys = (values: readonly FileConsumer[]) => values.map(({ kind, device, inode }) => `${kind}:${device}:${inode}`).sort();
  if (JSON.stringify(keys(before)) !== JSON.stringify(keys(after))) throw new ChangedConsumerError('Original file consumers changed');
  if (startedTick !== startTick(await metadata.read(join(directory, 'stat'), signal), tid)) throw new ChangedConsumerError('Original thread changed');
  consumers.push(...before);
}
async function retainedReferences(directory: string, id: string, tid: string, startedTick: string, wanted: ReadonlySet<string>, metadata: Metadata, signal?: AbortSignal, mappings = true, shared?: { files: boolean; fs: boolean }): Promise<FileConsumer[]> {
  const found = new Map<string, FileConsumer>();
  const record = (kind: FileConsumer['kind'], device: string, inode: string) => {
    if (wanted.has(identityKey(device, inode))) found.set(`${kind}:${device}:${inode}`, { pid: Number(id), tid: Number(tid), startedTick, kind, device, inode });
  };
  const descriptors = shared?.files ? [] : await metadata.entries(join(directory, 'fd'));
  if (descriptors.some((name) => !/^[0-9]+$/.test(name))) throw new Error('Unknown descriptor entry');
  const links: { name: string; kind: FileConsumer['kind'] }[] = descriptors.map((name) => ({ name: join('fd', name), kind: 'descriptor' }));
  for (const kind of ['cwd', 'root', 'executable'] as const) if (!(shared?.fs && kind !== 'executable') && !(shared && !mappings && kind === 'executable')) links.push({ name: kind === 'executable' ? 'exe' : kind, kind });
  for (const link of links) {
    await metadata.checkpoint(signal);
    try { const observed = await metadata.identity(join(directory, link.name)); record(link.kind, String(observed.dev), String(observed.ino)); }
    catch (error) { if (!isMissing(error)) throw error; }
  }
  return [...found.values(), ...mappings ? await mappingReferences(directory, id, tid, startedTick, wanted, metadata, signal) : []];
}
async function mappingReferences(directory: string, id: string, tid: string, startedTick: string, wanted: ReadonlySet<string>, metadata: Metadata, signal?: AbortSignal): Promise<FileConsumer[]> {
  const maps = await metadata.read(join(directory, 'maps'), signal), found = new Map<string, FileConsumer>();
  for (const line of maps.split('\n').filter(Boolean)) {
    signal?.throwIfAborted(); const match = /^[a-f0-9]+-[a-f0-9]+\s+[-rwxps]+\s+[a-f0-9]+\s+([a-f0-9]+):([a-f0-9]+)\s+([0-9]+)(?:\s|$)/i.exec(line);
    if (!match) throw new Error('Unknown mapping format');
    if (match[3] !== '0') {
      const device = linuxDevice(BigInt(`0x${match[1]}`), BigInt(`0x${match[2]}`)), inode = match[3]!;
      if (wanted.has(identityKey(device, inode))) found.set(device + ':' + inode, { pid: Number(id), tid: Number(tid), startedTick, kind: 'mapping', device, inode });
    }
  }
  return [...found.values()];
}
const isMissing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';
