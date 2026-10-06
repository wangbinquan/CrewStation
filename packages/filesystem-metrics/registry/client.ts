import {createHash} from 'node:crypto';
import {RegistryInventoryRequestSchema,RegistryInventoryResponseSchema,registryRequestIdentity} from './protocol';
import type {RegistryInventoryRequest} from './protocol';
import {registryDirectory,registryFile,registryOwnsRepository} from './graph';
import { readProbeResponse } from '../probeRead';

export function createRegistryInventoryClient(options:{baseUrl:string;token:string;timeoutMs?:number;fetch?:(input:URL,init:RequestInit)=>Promise<Response>}) {
  const endpoint=new URL('/registry/inventory',options.baseUrl);
  if(!['http:','https:'].includes(endpoint.protocol)||endpoint.username||endpoint.password||options.token.length<32)throw new Error('Invalid registry source configuration');
  const request=options.fetch??globalThis.fetch;
  return {observe:async (raw:RegistryInventoryRequest,signal?:AbortSignal)=>{
    const input=RegistryInventoryRequestSchema.parse(raw);
    const deadline = AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(options.timeoutMs??35_000)]);
    const observeDeadline = () => {}; deadline.addEventListener('abort', observeDeadline, { once: true });
    try {
    const response=await readProbeResponse(request,endpoint,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+options.token,'content-type':'application/json'},body:JSON.stringify(input)},deadline);
    if(!response.ok)throw new Error(`Registry source HTTP ${response.status}`);
    const result=RegistryInventoryResponseSchema.parse(JSON.parse(await boundedReply(response,deadline)));
    deadline.throwIfAborted();
    if(result.key!==input.key||result.requestIdentity!==registryRequestIdentity(input))throw new Error('Registry source returned another original scope');
    const owns=(name:string)=>registryOwnsRepository(input,name);
    if(result.repositories.some(name=>!owns(name))||new Set(result.repositories).size!==result.repositories.length)throw new Error('Registry source returned foreign repositories');
    if(new Set(result.entries.map(e=>e.path)).size!==result.entries.length||new Set(result.blobs.map(b=>b.digest)).size!==result.blobs.length)throw new Error('Registry source returned duplicate native identities');
    for(const entry of result.entries) {
      if(!entry.path.startsWith('repositories/')||!owns(entry.path.slice(13).split('/_')[0]!))throw new Error('Registry source returned foreign native paths');
      if(entry.kind==='directory')registryDirectory(entry.path);else registryFile(entry);
      verifyEpoch(entry,entry.kind);
    }
    for(const blob of result.blobs) {
      const native=registryFile({...blob,kind:'file'});
      if(native.kind!=='blob'||native.digest!==blob.digest||blob.otherRepositories.some(owns))throw new Error('Registry source returned conflicting native blobs');
      verifyEpoch(blob,'file');
    }
    return result;
    } finally { deadline.removeEventListener('abort', observeDeadline); }
  }};
}
function verifyEpoch(value:{identity:string;device:string;inode:string;birthtimeNs:string},kind:'file'|'directory') {
  const epoch=createHash('sha256').update(JSON.stringify([kind,value.device,value.inode,value.birthtimeNs])).digest('hex');
  if(epoch!==value.identity)throw new Error('Registry source native file epoch is inconsistent');
}
async function boundedReply(response:Response,signal:AbortSignal):Promise<string> {
  if(Number(response.headers.get('content-length'))>8_388_608||!response.body)throw new Error('Registry source response is empty or oversized');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try {
    while(true){signal.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>8_388_608)throw new Error('Registry source response is oversized');chunks.push(part.value);}
    signal.throwIfAborted();
    return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  }finally{signal.removeEventListener('abort',abort);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
