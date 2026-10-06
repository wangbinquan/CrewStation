import {describe,expect,test} from 'bun:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm,readFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {observeRegistryInventory} from './inventory';
import type {RegistryInventoryRequest} from './protocol';
import {RegistryInventoryResponseSchema} from './protocol';
import {registryTree} from './tree';
import {createFilesystemMetricsHandler} from '../server';
import {createRegistryInventoryClient} from './client';

const sha=(bytes:string|Uint8Array)=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'cs-registry-native-')),base=join(root,'volume','docker','registry','v2');
  const file=async (path:string,body:string|Uint8Array)=>{const full=join(base,path);await mkdir(full.slice(0,full.lastIndexOf('/')),{recursive:true});await writeFile(full,body);return full;};
  const blob=async (bytes:string|Uint8Array)=>{const digest=sha(bytes),hex=digest.slice(7);await file(`blobs/sha256/${hex.slice(0,2)}/${hex}/data`,bytes);return digest;};
  const manifest=async (config:string,layers:string[])=>blob(JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',config:{digest:config},layers:layers.map(digest=>({digest}))}));
  const link=async (repo:string,digest:string,kind='revisions')=>file(`repositories/${repo}/_manifests/${kind}/sha256/${digest.slice(7)}/link`,digest);
  const input:RegistryInventoryRequest={key:'original registry',rootId:'local',directory:'volume',exact:['apps/original'],prefixes:['runtime/projects/original'],retainedDigests:[],retainedManifests:[]};
  return {root,base,file,blob,manifest,link,input,drop:()=>rm(root,{recursive:true,force:true})};
}
describe('Distribution native filesystem inventory; no production erasure claim',()=>{
  test('a stalled successful inventory body observes its original timeout',async()=>{
    const f=await fixture();let cancelled=false,guard:ReturnType<typeof setTimeout>|undefined;
    try{
      const client=createRegistryInventoryClient({baseUrl:'http://source',token:'original-registry-source-token-over-32-characters',timeoutMs:20,
        fetch:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))});
      const result=await Promise.race([client.observe(f.input).catch((error:unknown)=>error),new Promise(resolve=>{guard=setTimeout(()=>resolve('deadline escaped'),250);})]);
      expect(result).toBeInstanceOf(Error);expect(cancelled).toBe(true);
    }finally{clearTimeout(guard);await f.drop();}
  });

  test('untagged and overwritten revisions include original layers and preserve every foreign reference',async()=>{
    const f=await fixture();try{
      const config=await f.blob('{"architecture":"arm64"}'),own=await f.blob('original layer'),shared=await f.blob('shared layer'),foreign=await f.blob('other project');
      const old=await f.manifest(config,[own,shared]),current=await f.manifest(config,[shared]),other=await f.manifest(config,[shared,foreign]);
      await f.link('apps/original',old);await f.link('apps/original',current);await f.link('apps/other',other);
      await f.file('repositories/apps/original/_manifests/tags/current/current/link',current);
      const result=await observeRegistryInventory(f.root,f.input);
      expect(result.complete).toBe(true);expect(result.repositories).toEqual(['apps/original']);
      expect(result.blobs.map(b=>b.digest)).toContain(old);expect(result.blobs.map(b=>b.digest)).toContain(own);
      expect(result.blobs.find(b=>b.digest===shared)?.otherRepositories).toEqual(['apps/other']);
      expect(result.blobs.find(b=>b.digest===own)?.otherRepositories).toEqual([]);
      expect(result.blobs.map(b=>b.digest)).not.toContain(foreign);expect(result.entries.some(e=>e.path.includes('apps/other/'))).toBe(false);
      expect(await readFile(join(f.base,`blobs/sha256/${foreign.slice(7,9)}/${foreign.slice(7)}/data`),'utf8')).toBe('other project');
    }finally{await f.drop();}
  });
  test('a foreign current tag still retains its descendant bytes when the revision link is absent',async()=>{
    const f=await fixture();try{
      const config=await f.blob('{}'),foreignConfig=await f.blob('{"foreign":true}'),shared=await f.blob('shared'),own=await f.manifest(config,[shared]),foreign=await f.manifest(foreignConfig,[shared]);
      await f.link('apps/original',own);await f.file('repositories/apps/other/_manifests/tags/current/current/link',foreign);
      expect((await observeRegistryInventory(f.root,f.input)).blobs.find(b=>b.digest===shared)?.otherRepositories).toEqual(['apps/other']);
    }finally{await f.drop();}
  });
  test('HTTP unlink leaves retained native blob bytes in the captured scope',async()=>{
    const f=await fixture();try{
      const config=await f.blob('{}'),layer=await f.blob('still allocated'),image=await f.manifest(config,[layer]);await f.link('apps/original',image);
      const original=await observeRegistryInventory(f.root,f.input);
      await rm(join(f.base,'repositories/apps/original'),{recursive:true});
      const after=await observeRegistryInventory(f.root,{...f.input,retainedDigests:original.blobs.map(b=>b.digest)});
      expect(after.repositories).toHaveLength(0);expect(after.blobs).toHaveLength(3);expect(after.retainedAbsent).toHaveLength(0);
      expect(after.blobs.find(b=>b.digest===layer)?.bytes).toBe('still allocated'.length);
    }finally{await f.drop();}
  });
  test('an abandoned upload with no tags is included and a sibling project prefix is preserved',async()=>{
    const f=await fixture();try{
      await f.file('repositories/runtime/projects/original/build/image/_uploads/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/data','abandoned');
      await f.file('repositories/runtime/projects/original-other/build/image/_uploads/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/data','foreign');
      const result=await observeRegistryInventory(f.root,f.input);
      expect(result.entries.filter(e=>e.kind==='file').map(e=>e.bytes)).toEqual([9]);expect(result.repositories).toEqual(['runtime/projects/original/build/image']);
    }finally{await f.drop();}
  });
  test('retained original manifest roots include unlinked descendant bytes and multi-architecture revisions',async()=>{
    const f=await fixture();try{
      const config=await f.blob('{}'),layer=await f.blob('original'),image=await f.manifest(config,[layer]);
      const index=await f.blob(JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:[{digest:image}]}));
      await mkdir(join(f.base,'repositories'),{recursive:true});
      const result=await observeRegistryInventory(f.root,{...f.input,retainedManifests:[index]});
      expect(result.blobs.map(b=>b.digest).sort()).toEqual([config,layer,image,index].sort());expect(result.retainedAbsent).toEqual([]);
      const absent='sha256:'+'a'.repeat(64);
      expect((await observeRegistryInventory(f.root,{...f.input,retainedManifests:[absent]})).retainedAbsent).toEqual([absent]);
    }finally{await f.drop();}
  });
  test('native empty project directories remain visible and unsupported empty directories refuse completion',async()=>{
    const f=await fixture();try{
      await mkdir(join(f.base,'repositories/runtime/projects/original/abandoned/image/_uploads'),{recursive:true});
      expect((await observeRegistryInventory(f.root,f.input)).entries.some(e=>e.path.endsWith('/_uploads'))).toBe(true);
      await mkdir(join(f.base,'repositories/apps/other/_unknown'),{recursive:true});
      await expect(observeRegistryInventory(f.root,f.input)).rejects.toThrow('directory layout');
    }finally{await f.drop();}
  });
  test('native file changes and mount recreation cannot reuse the captured epochs',async()=>{
    const f=await fixture();let tree:Awaited<ReturnType<typeof registryTree>>|undefined;
    try{
      const layer=await f.blob('original');await mkdir(join(f.base,'repositories'),{recursive:true});
      tree=await registryTree(f.root,'volume',new AbortController().signal);
      await f.file(`blobs/sha256/${layer.slice(7,9)}/${layer.slice(7)}/data`,'changed');
      await expect(tree.verify()).rejects.toThrow('changed');
      await tree.close();tree=undefined;
      const first=await observeRegistryInventory(f.root,{...f.input,retainedDigests:[layer]});
      await rm(join(f.root,'volume'),{recursive:true});await f.blob('original');await mkdir(join(f.base,'repositories'),{recursive:true});
      const second=await observeRegistryInventory(f.root,{...f.input,retainedDigests:[layer]});
      expect(second.volumeIdentity).not.toBe(first.volumeIdentity);expect(second.blobs[0]?.identity).not.toBe(first.blobs[0]?.identity);
    }finally{await tree?.close();await f.drop();}
  });
  test('the actual private probe route enforces authentication, root allowlist, limits and cancellation',async()=>{
    const f=await fixture();try{
      await mkdir(join(f.base,'repositories/apps/original/_uploads'),{recursive:true});
      const token='registry-native-private-token'.padEnd(40,'0'),handler=createFilesystemMetricsHandler({token,roots:{local:f.root}});
      const request=(body:unknown=f.input,authorization='Bearer '+token,signal?:AbortSignal,method='POST')=>new Request('http://probe/registry/inventory',{method,body:JSON.stringify(body),headers:{authorization,'content-type':'application/json'},signal});
      expect((await handler(request(f.input,''))).status).toBe(401);
      expect((await handler(request({...f.input,rootId:'foreign'}))).status).toBe(400);
      expect((await handler(request('x'.repeat(40_000)))).status).toBe(400);
      expect((await handler(request(f.input,'Bearer '+token,undefined,'DELETE'))).status).toBe(404);
      const reply=await handler(request());expect(reply.status).toBe(200);expect(RegistryInventoryResponseSchema.parse(await reply.json()).complete).toBe(true);
      const aborted=new AbortController();aborted.abort();expect((await handler(request(f.input,'Bearer '+token,aborted.signal))).status).toBe(503);
      expect((await handler(request())).status).toBe(200);
      await rm(join(f.root,'volume'),{recursive:true});expect((await handler(request())).status).toBe(503);
    }finally{await f.drop();}
  });
  test('the actual registry client binds the native request and rejects foreign, duplicate or replaced file identities',async()=>{
    const f=await fixture();try{
      const config=await f.blob('{}'),layer=await f.blob('original'),image=await f.manifest(config,[layer]);await f.link('apps/original',image);
      const token='registry-client-private-token'.padEnd(40,'0'),handler=createFilesystemMetricsHandler({token,roots:{local:f.root}});
      let busy = true; const signals: AbortSignal[] = [];
      const client=createRegistryInventoryClient({baseUrl:'http://probe',token,fetch:(url,init)=>{
        signals.push(init.signal!);
        if (busy) { busy = false; return Promise.resolve(Response.json({ error: 'A measurement is already running' }, { status: 409 })); }
        return handler(new Request(url,init));
      }});
      const original=await client.observe(f.input);expect(original.blobs).toHaveLength(3);
      expect(signals).toHaveLength(2); expect(signals[0] === signals[1]).toBe(true);
      const mutations:Array<(result:typeof original)=>void>=[
        result=>{result.key='other original';},result=>{result.requestIdentity='b'.repeat(64);},result=>{result.repositories.push('apps/other');},
        result=>{result.entries.push({...result.entries[0]!,path:'repositories/apps/other/_uploads'});},
        result=>{result.entries.push(result.entries[0]!);},result=>{result.entries[0]!.identity='c'.repeat(64);},
        result=>{result.blobs.push(result.blobs[0]!);},result=>{result.blobs[0]!.digest='sha256:'+'d'.repeat(64);},
        result=>{result.blobs[0]!.otherRepositories=['apps/original'];},
      ];
      for(const mutate of mutations){const result=structuredClone(original);mutate(result);
        await expect(createRegistryInventoryClient({baseUrl:'http://probe',token,fetch:async()=>Response.json(result)}).observe(f.input)).rejects.toThrow();}
      const aborted=new AbortController();aborted.abort();const reads = signals.length;
      await expect(client.observe(f.input,aborted.signal)).rejects.toThrow(); expect(signals).toHaveLength(reads);
      expect(()=>createRegistryInventoryClient({baseUrl:'file:///tmp/native',token})).toThrow();
      expect(()=>createRegistryInventoryClient({baseUrl:'http://user:secret@probe',token})).toThrow();
      expect(()=>createRegistryInventoryClient({baseUrl:'http://probe',token:'short'})).toThrow();
      await expect(createRegistryInventoryClient({baseUrl:'http://probe',token,fetch:async()=>new Response(null,{status:503})}).observe(f.input)).rejects.toThrow('503');
      await expect(createRegistryInventoryClient({baseUrl:'http://probe',token,fetch:async()=>new Response(null)}).observe(f.input)).rejects.toThrow('empty');
      await expect(createRegistryInventoryClient({baseUrl:'http://probe',token,fetch:async()=>new Response('{}',{headers:{'content-length':'8388609'}})}).observe(f.input)).rejects.toThrow('oversized');
      await expect(createRegistryInventoryClient({baseUrl:'http://probe',token,fetch:async()=>new Response(new Uint8Array(8_388_609))}).observe(f.input)).rejects.toThrow('oversized');
      await expect(createRegistryInventoryClient({baseUrl:'http://probe',token,fetch:async()=>new Response(new Uint8Array([0xff]))}).observe(f.input)).rejects.toThrow();
    }finally{await f.drop();}
  });
  test('ambiguous manifest/index payloads cannot hide a foreign layer dependency',async()=>{
    const f=await fixture();try{
      const config=await f.blob('{}'),layer=await f.blob('original');
      const image=await f.blob(JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',config:{digest:config},layers:[{digest:layer}],manifests:[]}));
      await f.link('apps/original',image);await expect(observeRegistryInventory(f.root,f.input)).rejects.toThrow();
    }finally{await f.drop();}
  });
  for(const invalid of ['symlink','unknown file','conflicting link','missing bytes','changed manifest digest'])test(`${invalid} refuses a complete native scan`,async()=>{
    const f=await fixture();try{
      const config=await f.blob('{}'),layer=await f.blob('original'),image=await f.manifest(config,[layer]);await f.link('apps/original',image);
      if(invalid==='symlink')await symlink('/etc',join(f.base,'repositories/apps/original/escape'));
      if(invalid==='unknown file')await f.file('repositories/apps/original/_mystery/unknown','unregistered');
      if(invalid==='conflicting link')await f.file(`repositories/apps/original/_layers/sha256/${layer.slice(7)}/link`,config);
      if(invalid==='missing bytes')await rm(join(f.base,`blobs/sha256/${layer.slice(7,9)}/${layer.slice(7)}/data`));
      if(invalid==='changed manifest digest')await f.file(`blobs/sha256/${image.slice(7,9)}/${image.slice(7)}/data`,'{}');
      await expect(observeRegistryInventory(f.root,f.input)).rejects.toThrow();
    }finally{await f.drop();}
  });
  test('a missing volume or malformed ownership cannot become an empty successful inventory',async()=>{
    const f=await fixture();try{
      await expect(observeRegistryInventory(f.root,f.input)).rejects.toThrow();
      await expect(observeRegistryInventory(f.root,{...f.input,prefixes:['..']})).rejects.toThrow();
      await expect(observeRegistryInventory(f.root,{...f.input,exact:[],prefixes:[]})).rejects.toThrow();
    }finally{await f.drop();}
  });
});
