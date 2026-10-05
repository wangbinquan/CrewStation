import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import type {BigIntStats} from 'node:fs';
import {lstat,open,readdir} from 'node:fs/promises';
import type {FileHandle} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {filesystemSourceEpoch} from '../source';

export interface RegistryEntry {path: string; kind: 'file'|'directory'; identity: string; bytes: number; allocatedBytes: number; device: string; inode: string; birthtimeNs: string}
const stamp = (stat: BigIntStats) => [stat.dev,stat.ino,stat.birthtimeNs,stat.mtimeNs,stat.ctimeNs,stat.size,stat.blocks,stat.nlink,stat.mode].map(String).join(':');
const hash = (value: string|Uint8Array) => createHash('sha256').update(value).digest('hex');
export async function registryTree(root: string, directory: string, signal: AbortSignal) {
  if (!isAbsolute(root)) throw new Error('Registry source root must be absolute');
  const handles: FileHandle[] = [], observed = new Map<string,string>(), entries: RegistryEntry[] = [];
  const read = async (parent: FileHandle, parentPath: string, name: string) => {
    signal.throwIfAborted();
    const path = join(parentPath,name), handle = await open(join(process.platform === 'linux' ? `/proc/self/fd/${parent.fd}` : parentPath,name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    handles.push(handle); const stat = await handle.stat({bigint:true});
    if (stat.dev !== device || !stat.isDirectory() && !stat.isFile()) throw new Error('Registry storage crossed a filesystem or contains an unsupported entry');
    observed.set(path,stamp(stat));
    return {handle,path,stat};
  };
  let device: bigint;
  try {
    signal.throwIfAborted();
    const original = await open(root,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_DIRECTORY);
    handles.push(original); const rootStat = await original.stat({bigint:true}); device = rootStat.dev; observed.set(root,stamp(rootStat));
    let current = await read(original,root,directory);
    const volumeIdentity = filesystemSourceEpoch(current.stat,'directory');
    for (const part of ['docker','registry','v2']) current = await read(current.handle,current.path,part);
    const nativeRoot = current.path;
    const walk = async (parent: typeof current, relative: string, depth: number): Promise<void> => {
      if (depth > 48 || entries.length > 100_000) throw new Error('Registry inventory exceeded its complete-scan budget');
      const names = (await readdir(process.platform === 'linux' ? `/proc/self/fd/${parent.handle.fd}` : parent.path)).sort();
      for (const name of names) {
        if (entries.length >= 100_000) throw new Error('Registry inventory exceeded its complete-scan budget');
        if (!/^[A-Za-z0-9_.-]+$/.test(name) || name === '.' || name === '..') throw new Error('Registry storage name is unsupported');
        const child = await read(parent.handle,parent.path,name), path = relative ? relative+'/'+name : name;
        const kind = child.stat.isDirectory() ? 'directory' as const : 'file' as const;
        const bytes = kind === 'file' ? Number(child.stat.size) : 0;
        const allocatedBytes=Number(child.stat.blocks*512n);
        if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(allocatedBytes) || allocatedBytes < 0) throw new Error('Registry storage size is unsupported');
        entries.push({path,kind,bytes,allocatedBytes,device:String(child.stat.dev),inode:String(child.stat.ino),birthtimeNs:String(child.stat.birthtimeNs),identity:filesystemSourceEpoch(child.stat,kind)});
        if (kind === 'directory') await walk(child,path,depth+1);
        await child.handle.close(); handles.splice(handles.indexOf(child.handle),1);
      }
    };
    await walk(current,'',0);
    const bytes = async (entry: RegistryEntry, maximum: number) => {
      signal.throwIfAborted();
      if (entry.kind !== 'file' || entry.bytes > maximum) throw new Error('Registry document is not bounded');
      const path = join(nativeRoot,entry.path), handle = await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
      try {
        if (stamp(await handle.stat({bigint:true})) !== observed.get(path)) throw new Error('Registry document changed before reading');
        const result=await boundedDocument(handle,maximum,signal);
        if (stamp(await handle.stat({bigint:true})) !== observed.get(path)) throw new Error('Registry document changed while reading');
        return result;
      } finally { await handle.close(); }
    };
    const verify = async () => { for (const [path,originalStamp] of observed) {
      signal.throwIfAborted(); if (stamp(await lstat(path,{bigint:true})) !== originalStamp) throw new Error('Registry native tree changed during observation');
    } };
    return {entries,bytes,verify,rootIdentity:filesystemSourceEpoch(rootStat,'directory'),volumeIdentity,
      revision: () => hash(JSON.stringify([...observed.entries()].map(([path,value])=>[path.slice(nativeRoot.length),value]))),
      close: async () => { await Promise.all(handles.splice(0).map(handle=>handle.close())); }};
  } catch (error) { await Promise.all(handles.map(handle=>handle.close())); throw error; }
}
async function boundedDocument(handle:FileHandle,maximum:number,signal:AbortSignal):Promise<Buffer> {
  const chunks:Buffer[]=[],buffer=Buffer.alloc(Math.min(maximum+1,65_536));let size=0;
  while(true) {
    signal.throwIfAborted();const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;
    size+=bytesRead;if(size>maximum)throw new Error('Registry document exceeded its read budget');
    chunks.push(Buffer.from(buffer.subarray(0,bytesRead)));
  }
  return Buffer.concat(chunks,size);
}
