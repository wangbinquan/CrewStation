import {createHash} from 'node:crypto';
import {RegistryInventoryRequestSchema,RegistryInventoryResponseSchema,registryRequestIdentity} from './protocol';
import type {RegistryInventoryRequest,RegistryInventoryResponse} from './protocol';
import {registryTree} from './tree';
import {registryReferences} from './graph';

/** Native filesystem inventory only: neither HTTP unlink, producer closure nor byte erasure is inferred. */
export async function observeRegistryInventory(root:string,input:RegistryInventoryRequest,signal:AbortSignal=AbortSignal.timeout(30_000)):Promise<RegistryInventoryResponse> {
  RegistryInventoryRequestSchema.parse(input);
  const tree=await registryTree(root,input.directory,signal);
  try {
    const graph=await registryReferences(tree.entries,tree.bytes,input.retainedManifests);
    const owns=(name:string)=>input.exact.includes(name)||input.prefixes.some(prefix=>name===prefix||name.startsWith(prefix+'/'));
    const repositories=[...new Set([...graph.files.values()].flatMap(entry=>entry.kind==='blob'?[]:[entry.repository]))].filter(owns).sort();
    const entries=tree.entries.filter(entry=>entry.path.startsWith('repositories/')&&owns(entry.path.slice(13).split('/_')[0]!));
    const retained=new Set([...input.retainedDigests,...input.retainedManifests]), blobs:RegistryInventoryResponse['blobs']=[];
    const include=(value:string)=>{retained.add(value);for(const child of graph.edges.get(value)??[])if(!retained.has(child))include(child);};
    for(const value of input.retainedManifests)include(value);
    for (const [digest,entry] of graph.blobs) {
      const refs=[...(graph.references.get(digest)??[])].sort();
      if (!retained.has(digest)&&!refs.some(owns)) continue;
      const {kind:_kind,...file}=entry;
      blobs.push({digest,...file,otherRepositories:refs.filter(name=>!owns(name))});
    }
    await tree.verify();
    const fixed={repositories,entries,blobs:blobs.sort((a,b)=>a.digest.localeCompare(b.digest)),retainedAbsent:[...retained].filter(value=>!graph.blobs.has(value)).sort()};
    const revision=createHash('sha256').update(JSON.stringify({input,tree:tree.revision(),...fixed})).digest('hex');
    return RegistryInventoryResponseSchema.parse({key:input.key,requestIdentity:registryRequestIdentity(input),layout:'distribution-filesystem/v2',complete:true,rootIdentity:tree.rootIdentity,volumeIdentity:tree.volumeIdentity,revision,observedAt:new Date().toISOString(),...fixed});
  } finally {await tree.close();}
}
