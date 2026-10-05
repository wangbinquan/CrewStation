import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { filesystemSourceEpoch } from '../../source';
import { qualifyNativeGitInput } from './gitInputs';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stamp = (stat: BigIntStats) => [stat.dev, stat.ino, stat.birthtimeNs, stat.size, stat.mtimeNs, stat.ctimeNs, stat.nlink, stat.mode].map(String).join(':');
const component = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,252}$/;
export const BuildKitInputRequestSchema = z.strictObject({ key: z.string().min(1).max(200), directory: z.string().regex(component),
  storageIds: z.array(z.string().regex(/^[1-9][0-9]*$/)).min(1).max(128),
  gitInputs: z.array(z.strictObject({ repositoryIdentity: z.string().regex(/^[a-f0-9]{64}$/), commit: z.string().regex(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/),
    tree: z.array(z.strictObject({ path: z.string().min(1).max(8192), mode: z.enum(['100644', '100755']), blob: z.string().regex(/^[a-f0-9]{40}$|^[a-f0-9]{64}$/) })).max(200_000).optional() })).max(10_000).optional() }).refine(input => new Set(input.storageIds).size === input.storageIds.length);
type Row = { path: string; kind: 'file' | 'directory'; identity: string; digest?: string; gitBlob?: string; executable?: boolean };
type Pinned = { handle: FileHandle; path: string; stat: BigIntStats };
/** Read full original input trees and the independently installed template.
 * All bytes stay private; only complete paths, births and SHA256 are emitted.
 * Names, reuse counts and cache descriptions never establish platform sharing. */
export async function observeBuildKitPlatformInputs(options: { root: string; templateRoot: string }, raw: z.infer<typeof BuildKitInputRequestSchema>, signal = AbortSignal.timeout(30_000)) {
  const input = BuildKitInputRequestSchema.parse(raw);
  if (![options.root, options.templateRoot].every(isAbsolute)) throw Error('Native BuildKit input roots must be installation-owned absolute paths');
  const handles: FileHandle[] = [], observed = new Map<string, string>();
  const pin = async (path: string, physical: string, kind: 'file' | 'directory', device?: bigint): Promise<Pinned> => {
    signal.throwIfAborted(); const handle = await open(physical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | (kind === 'directory' ? constants.O_DIRECTORY : 0));
    handles.push(handle); const stat = await handle.stat({ bigint: true });
    if (device !== undefined && device !== stat.dev || kind === 'file' && stat.nlink !== 1n) throw Error('Native BuildKit input aliases another file or crosses its original filesystem');
    filesystemSourceEpoch(stat, kind); observed.set(path, stamp(stat)); return { handle, path, stat };
  };
  const from = (parent: Pinned) => process.platform === 'linux' ? '/proc/self/fd/' + parent.handle.fd : parent.path;
  const below = async (parent: Pinned, name: string, kind: 'file' | 'directory') => pin(join(parent.path, name), join(from(parent), name), kind, parent.stat.dev);
  const tree = async (root: Pinned) => {
    const rows: Row[] = []; let bytes = 0;
    const walk = async (parent: Pinned, relative: string, depth: number): Promise<void> => {
      if (depth > 64) throw Error('Native BuildKit input tree exceeds complete depth');
      for (const name of (await readdir(from(parent))).sort()) {
        signal.throwIfAborted(); if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\0') || Buffer.byteLength(name) > 255 || rows.length >= 200_000) throw Error('Native BuildKit input complete tree is unsupported or oversized');
        const physical = join(from(parent), name), kind = (await lstat(physical)).isDirectory() ? 'directory' as const : 'file' as const;
        const child = await below(parent, name, kind), path = relative ? relative + '/' + name : name;
        const row: Row = { path, kind, identity: filesystemSourceEpoch(child.stat, kind) }; rows.push(row);
        if (kind === 'directory') await walk(child, path, depth + 1);
        else {
          bytes += Number(child.stat.size); if (child.stat.size > 16_777_216n || bytes > 268_435_456) throw Error('Native BuildKit input byte budget exceeded');
          const digest = createHash('sha256'), gitBlob = createHash('sha1').update('blob ' + child.stat.size + '\0'), buffer = Buffer.alloc(65_536); let count = 0;
          for (;;) { signal.throwIfAborted(); const part = await child.handle.read(buffer, 0, buffer.length, null); if (!part.bytesRead) break;
            count += part.bytesRead; if (count > Number(child.stat.size)) throw Error('Native BuildKit input grew while reading'); digest.update(buffer.subarray(0, part.bytesRead)); gitBlob.update(buffer.subarray(0, part.bytesRead)); }
          if (count !== Number(child.stat.size)) throw Error('Native BuildKit input did not reach complete original EOF'); row.digest = 'sha256:' + digest.digest('hex'); row.gitBlob = gitBlob.digest('hex'); row.executable = !!(child.stat.mode & 0o111n);
        }
        if (stamp(await child.handle.stat({ bigint: true })) !== stamp(child.stat)) throw Error('Native BuildKit input changed while reading');
        await child.handle.close(); handles.splice(handles.indexOf(child.handle), 1);
      }
    };
    await walk(root, '', 0); return rows;
  };
  try {
    const root = await pin(options.root, options.root, 'directory'), template = await pin(options.templateRoot, options.templateRoot, 'directory');
    const templateRows = await tree(template), templateFiles = templateRows.filter(row => row.kind === 'file').map(row => ({ path: row.path, digest: row.digest! }));
    if (!templateFiles.length) throw Error('Independent installed platform template is empty');
    let base = await below(root, input.directory, 'directory'); const volumeIdentity = filesystemSourceEpoch(base.stat, 'directory');
    for (const name of ['runc-overlayfs', 'snapshots', 'snapshots']) base = await below(base, name, 'directory');
    const inputs = [];
    for (const storageId of input.storageIds) {
      const directory = await below(base, storageId, 'directory'), fs = await below(directory, 'fs', 'directory'), files = await tree(fs);
      const sharedPlatformContentsProven = files.some(row => row.kind === 'file') && files.every(row => row.kind === 'file'
        ? templateFiles.some(actual => actual.path === row.path && actual.digest === row.digest) : templateFiles.some(actual => actual.path.startsWith(row.path + '/')));
      const projectMatches = await qualifyNativeGitInput(fs.path, files, input.gitInputs ?? [], signal);
      inputs.push({ storageId, sourceIdentity: hash({ volumeIdentity, directory: filesystemSourceEpoch(directory.stat, 'directory'), fs: filesystemSourceEpoch(fs.stat, 'directory'), files,
        templateIdentity: filesystemSourceEpoch(template.stat, 'directory'), templateFiles, projectMatches }), files: files.map(({ identity: _identity, gitBlob: _git, executable: _executable, ...row }) => row), templateFiles, sharedPlatformContentsProven, projectMatches });
    }
    for (const [path, original] of observed) { signal.throwIfAborted(); if (stamp(await lstat(path, { bigint: true })) !== original) throw Error('Native BuildKit input or independent template changed during full observation'); }
    const body = { version: 1 as const, key: input.key, rootIdentity: filesystemSourceEpoch(root.stat, 'directory'), volumeIdentity,
      templateIdentity: filesystemSourceEpoch(template.stat, 'directory'), inputs, complete: true as const };
    return { ...body, identity: hash(body), physicalReclamationProven: false as const, observedAt: new Date().toISOString() };
  } finally { await Promise.all(handles.map(handle => handle.close())); }
}
