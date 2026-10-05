import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { consumerMetadata } from '../consumerMetadata';
import { ProcessOwnerRequestSchema, ProcessOwnerResponseSchema } from './protocol';
import type { ProcessOwnerRequest, ProcessOwnerResponse } from './protocol';

const hash = (raw: unknown) => createHash('sha256').update(JSON.stringify(raw)).digest('hex');
function birth(value: string, id: string) {
  const end = value.lastIndexOf(') '), tick = end < 0 ? undefined : value.slice(end + 2).trim().split(/\s+/)[19];
  if (!value.startsWith(id + ' (') || !tick || !/^[1-9][0-9]*$/.test(tick)) throw Error('Original native process birth is incomplete'); return tick;
}
function groups(raw: string) {
  if (!raw || Buffer.byteLength(raw) > 1_048_576) throw Error('Native process cgroup metadata is incomplete');
  return raw.trim().split('\n').map(line => {
    const match = /^[0-9]+:[A-Za-z0-9_,=.-]*:(\/[^\0\r\n]*)$/.exec(line);
    if (!match) throw Error('Native process cgroup format is unsupported');
    // Kernel paths outside this probe's cgroup namespace have leading /../.
    // These are compared as metadata only and never used as filesystem paths.
    const parts = match[1]!.split('/').slice(1); while (parts[0] === '..') parts.shift();
    if (parts.some(part => part === '..' || part === '.')) throw Error('Native process cgroup format is unsupported'); return match[1]!;
  });
}
function matcher(owner: ProcessOwnerRequest['owners'][number]) {
  const pod = owner.podUid.replaceAll('-', '[-_]'), cid = owner.containerId?.split('://')[1];
  const podPattern = new RegExp('(?:^|[-/])pod' + pod + '(?:\\.slice|/|$)'), containerPattern = cid ? new RegExp('(?:^|[-/])' + cid + '(?:\\.scope|/|$)') : undefined;
  return (paths: string[]) => paths.some(path => podPattern.test(path) || containerPattern?.test(path));
}
/** Whole host thread/cgroup EOF, separate from file users. A dead HTTP
 * connection or missing API Pod cannot substitute for this native source. */
export async function observeProcessOwners(root: string, raw: ProcessOwnerRequest, signal = AbortSignal.timeout(10_000)): Promise<ProcessOwnerResponse> {
  const input = ProcessOwnerRequestSchema.parse(raw), metadata = consumerMetadata(root), owners = input.owners.map(row => ({ key: row.key, threads: [] as ProcessOwnerResponse['owners'][number]['threads'] }));
  const selected = input.owners.map(matcher);
  const blockers: ProcessOwnerResponse['blockers'] = []; let bootId = '', namespace = '', cgroupNamespace = '';
  const ids = async (path: string) => (await metadata.entries(path)).filter(id => /^[1-9][0-9]*$/.test(id)).sort();
  try {
    bootId = (await metadata.read(join(root, 'sys/kernel/random/boot_id'), signal)).trim(); namespace = await metadata.link(join(root, 'self/ns/pid'));
    cgroupNamespace = await metadata.link(join(root, 'self/ns/cgroup'));
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(bootId) || !/^pid:\[[1-9][0-9]*\]$/.test(namespace) || !/^cgroup:\[[1-9][0-9]*\]$/.test(cgroupNamespace)) throw Error('Original native process namespace is invalid');
    const before = await ids(root); if (!before.length) throw Error('Original native process namespace is empty');
    for (const pid of before) {
      await metadata.checkpoint(signal);
      try {
        const directory = join(root, pid), started = birth(await metadata.read(join(directory, 'stat'), signal), pid), threads = await ids(join(directory, 'task'));
        if (!threads.includes(pid)) throw Error('Original native thread catalog is incomplete');
        const found: Array<{ tid: string; startTicks: string; paths: string[] }> = [];
        for (const tid of threads) {
          await metadata.checkpoint(signal); const path = join(directory, 'task', tid), startTicks = birth(await metadata.read(join(path, 'stat'), signal), tid);
          const first = groups(await metadata.read(join(path, 'cgroup'), signal)), second = groups(await metadata.read(join(path, 'cgroup'), signal));
          if (json(first) !== json(second) || startTicks !== birth(await metadata.read(join(path, 'stat'), signal), tid)) throw Error('changed');
          found.push({ tid, startTicks, paths: first });
        }
        if (json(threads) !== json(await ids(join(directory, 'task'))) || started !== birth(await metadata.read(join(directory, 'stat'), signal), pid)) throw Error('changed');
        for (const thread of found) for (let index = 0; index < input.owners.length; index++) if (selected[index]!(thread.paths)) owners[index]!.threads.push({ pid: Number(pid), tid: Number(thread.tid), startTicks: thread.startTicks, identity: hash({ bootId, namespace, cgroupNamespace, pid, ...thread }) });
      } catch (error) { if (signal.aborted) throw error; blockers.push({ code: error instanceof Error && error.message === 'changed' ? 'process-changed' : 'process-unreadable', pid: Number(pid) }); }
    }
    if (json(before) !== json(await ids(root)) || bootId !== (await metadata.read(join(root, 'sys/kernel/random/boot_id'), signal)).trim() || namespace !== await metadata.link(join(root, 'self/ns/pid')) || cgroupNamespace !== await metadata.link(join(root, 'self/ns/cgroup'))) blockers.push({ code: 'process-changed' });
    if (input.source && (input.source.bootId !== bootId || input.source.namespace !== namespace || input.source.cgroupNamespace !== cgroupNamespace)) blockers.push({ code: 'source-changed' });
  } catch (error) { if (signal.aborted) throw error; blockers.push({ code: 'source-unreadable' }); }
  signal.throwIfAborted(); return ProcessOwnerResponseSchema.parse({ version: 1, bootId, namespace, cgroupNamespace, complete: !blockers.length, owners, blockers });
}
const json = JSON.stringify;
