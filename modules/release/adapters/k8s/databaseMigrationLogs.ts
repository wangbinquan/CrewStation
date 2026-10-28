import type { K8sClient } from '@crewstation/k8s';
import { MIGRATION_LOG_LIMIT, parseMigrationMarker } from '../../domain/database-migration/evidence';
export async function migrationJobLog(k8s:K8sClient,namespace:string,pod:string,container:string){
 const reader=(await k8s.logs(namespace,pod,{container,follow:false,signal:AbortSignal.timeout(30_000)})).getReader(),decoder=new TextDecoder();let total=0,text='';
 try{for(;;){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>MIGRATION_LOG_LIMIT)return {output:null,logTail:'迁移日志超过 16 MiB'};text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
 finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
 return {output:parseMigrationMarker(text),logTail:text.slice(-8192)};
}
