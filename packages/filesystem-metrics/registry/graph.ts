import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {RegistryEntry} from './tree';

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/), descriptor = z.object({digest});
const image = z.object({schemaVersion:z.literal(2),mediaType:z.enum(['application/vnd.oci.image.manifest.v1+json','application/vnd.docker.distribution.manifest.v2+json']).optional(),config:descriptor,layers:z.array(descriptor).max(4096),manifests:z.never().optional(),subject:descriptor.optional()});
const index = z.object({schemaVersion:z.literal(2),mediaType:z.enum(['application/vnd.oci.image.index.v1+json','application/vnd.docker.distribution.manifest.list.v2+json']).optional(),manifests:z.array(descriptor).max(4096),config:z.never().optional(),layers:z.never().optional(),subject:descriptor.optional()});
const repository = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;
export function registryDirectory(path:string) {
  if (path==='repositories'||path==='blobs'||path==='blobs/sha256') return;
  if (/^blobs\/sha256\/[a-f0-9]{2}$/.test(path)) return;
  const blob=/^blobs\/sha256\/([a-f0-9]{2})\/([a-f0-9]{64})$/.exec(path);
  if(blob&&blob[1]===blob[2]!.slice(0,2))return;
  if(!path.startsWith('repositories/'))throw new Error('Registry native directory layout is unsupported');
  const relative=path.slice(13),marker=relative.indexOf('/_'),name=marker<0?relative:relative.slice(0,marker);
  if(!repository.test(name))throw new Error('Registry native directory ownership is invalid');
  if(marker<0)return;
  const local=relative.slice(marker+1);
  if (/^_layers(?:\/sha256(?:\/[a-f0-9]{64})?)?$/.test(local)
    || /^_manifests(?:\/revisions(?:\/sha256(?:\/[a-f0-9]{64})?)?|\/tags(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}(?:\/current|\/index(?:\/sha256(?:\/[a-f0-9]{64})?)?)?)?)?$/.test(local)
    || /^_uploads(?:\/[a-f0-9-]{36}(?:\/hashstates(?:\/sha256)?)?)?$/.test(local))return;
  throw new Error('Registry native directory layout is unsupported');
}
export function registryFile(entry: RegistryEntry) {
  const blob = /^blobs\/sha256\/([a-f0-9]{2})\/([a-f0-9]{64})\/data$/.exec(entry.path);
  if (blob) {
    if (blob[1] !== blob[2]!.slice(0,2)) throw new Error('Registry blob path has a conflicting digest');
    return {kind:'blob' as const,digest:'sha256:'+blob[2]};
  }
  const marker = entry.path.indexOf('/_',13);
  if (!entry.path.startsWith('repositories/') || marker < 0) throw new Error('Registry native file layout is unsupported');
  const name = entry.path.slice(13,marker), local = entry.path.slice(marker+1);
  if (!repository.test(name)) throw new Error('Registry native repository is invalid');
  const link = /^(?:_layers\/sha256|_manifests\/revisions\/sha256)\/([a-f0-9]{64})\/link$/.exec(local)
    ?? /^_manifests\/tags\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}\/index\/sha256\/([a-f0-9]{64})\/link$/.exec(local);
  if (link) return {kind:local.startsWith('_manifests/') ? 'manifest' as const : 'link' as const,repository:name,digest:'sha256:'+link[1]};
  if (/^_manifests\/tags\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}\/current\/link$/.test(local)) return {kind:'manifest' as const,repository:name};
  if (/^_uploads\/[a-f0-9-]{36}\/(?:data|startedat|hashstates\/sha256\/[0-9]+)$/.test(local)) return {kind:'upload' as const,repository:name};
  throw new Error('Registry native file layout is unsupported');
}
/** Scan every manifest revision, including overwritten tags and untagged indices. */
export async function registryReferences(entries: RegistryEntry[], read: (entry: RegistryEntry,maximum:number)=>Promise<Uint8Array>,retainedManifests:string[]) {
  const blobs = new Map<string,RegistryEntry>(), edges = new Map<string,string[]>(), direct = new Map<string,Set<string>>();
  const manifests = new Set<string>(), files = new Map<string,ReturnType<typeof registryFile>>();
  for(const entry of entries.filter(e=>e.kind==='directory'))registryDirectory(entry.path);
  for (const entry of entries.filter(e=>e.kind==='file')) {
    const parsed = registryFile(entry); files.set(entry.path,parsed);
    if (parsed.kind==='blob') { if (blobs.has(parsed.digest)) throw new Error('Registry native blob is duplicated'); blobs.set(parsed.digest,entry); continue; }
    if (parsed.kind==='upload') continue;
    const value = new TextDecoder('utf-8',{fatal:true}).decode(await read(entry,71));
    digest.parse(value); if (parsed.digest && parsed.digest!==value) throw new Error('Registry native link disagrees with its original digest');
    const refs = direct.get(value)??new Set<string>(); refs.add(parsed.repository); direct.set(value,refs);
    if (parsed.kind==='manifest') manifests.add(value);
  }
  const inspect = async (value:string,ancestors:Set<string>):Promise<void> => {
    if (ancestors.has(value)||ancestors.size>64) throw new Error('Registry manifest graph contains a cycle or exceeded its complete-scan budget');
    if (edges.has(value)) return;
    const entry=blobs.get(value); if (!entry) throw new Error('Registry native manifest bytes are absent');
    const bytes=await read(entry,16*1024*1024);
    if ('sha256:'+createHash('sha256').update(bytes).digest('hex')!==value) throw new Error('Registry native manifest digest does not match its bytes');
    const raw:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)), parsed=index.safeParse(raw);
    const document=parsed.success?parsed.data:image.parse(raw);
    const children=parsed.success?parsed.data.manifests:[image.parse(raw).config,...image.parse(raw).layers];
    edges.set(value,[...children.map(c=>c.digest),...(document.subject?[document.subject.digest]:[])]);
    if (parsed.success) for (const child of parsed.data.manifests) await inspect(child.digest,new Set([...ancestors,value]));
    if(document.subject)await inspect(document.subject.digest,new Set([...ancestors,value]));
  };
  for(const value of retainedManifests)if(blobs.has(value))manifests.add(value);
  for (const value of manifests) await inspect(value,new Set());
  const references = new Map<string,Set<string>>();
  const include=(value:string,name:string,seen:Set<string>)=>{
    if (seen.has(value)) return; seen.add(value);
    if (!blobs.has(value)) throw new Error('Registry native referenced bytes are absent');
    const refs=references.get(value)??new Set<string>(); if(refs.has(name))return; refs.add(name); references.set(value,refs);
    for (const child of edges.get(value)??[]) include(child,name,seen);
  };
  for (const [value,names] of direct) for (const name of names) include(value,name,new Set());
  return {blobs,references,files,edges};
}
