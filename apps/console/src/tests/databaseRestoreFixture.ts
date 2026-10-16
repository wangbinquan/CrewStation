import {DatabaseRestoreDtoSchema} from '@crewstation/contracts';
import {projectId,serviceId,userId,prodId,targetId,releaseDeliveryFixture} from './releaseDeliveryFixture';
export const operationId='01a1428f-eabe-7000-af4c-887037988561',generationId='01a1428f-eabe-7000-af4c-887037988562',restoredId='01a1428f-eabe-7000-af4c-887037988563';
export function databaseRestoreFixture(){
 const delivery=releaseDeliveryFixture();delivery.state.admin=true;delivery.releases[1]!.databaseRestoreSupported=true;
 const base=globalThis.fetch,op=DatabaseRestoreDtoSchema.parse({id:operationId,projectId,serviceId,revision:5,stage:'ready-to-switch',sourceGenerationId:generationId,targetGenerationId:restoredId,sourceReleaseId:prodId,restoreReleaseId:targetId,image:'registry/app@sha256:'+'a'.repeat(64),backupReference:'backup-original',backupReferenceDigest:'b'.repeat(64),createdBy:userId,createdAt:'2026-10-16T00:00:00.000Z',updatedAt:'2026-10-16T00:00:00.000Z',previousAttempts:[],restoreJob:null,verifyJob:null,verification:{version:1,backupReferenceDigest:'b'.repeat(64),schemaDigest:'c'.repeat(64),complete:true,autoResumeSuspended:true},confirmationDigest:'d'.repeat(64),actions:['switch'],error:null,blockedReason:null});
 const state={readError:false,loseResponse:false,wrongResponse:false,items:[op]},writes:Array<{path:string;body:Record<string,unknown>}>=[];
 globalThis.fetch=(async(raw,init)=>{
  const path=new URL(String(raw),'http://localhost').pathname,method=init?.method??'GET';
  if(path.includes('/database-restores')||path.endsWith('/database-generations')){
   if(method!=='GET'){const body=JSON.parse(String(init?.body??'{}')) as Record<string,unknown>;writes.push({path,body});if(state.loseResponse)throw new TypeError('response lost');if(path.endsWith('/switch'))return Response.json({...op,stage:'freezing',revision:op.revision+1,actions:[],confirmationDigest:null});if(path.endsWith('/abandon'))return Response.json({...op,stage:'abandoned',revision:op.revision+1,actions:[],confirmationDigest:null,abandonedBy:userId,abandonedAt:'2026-10-16T01:00:00.000Z'});return Response.json({...op,id:state.wrongResponse?Bun.randomUUIDv7():body.requestId??op.id,stage:'requested',confirmationDigest:null,actions:['retry']});}
   if(state.readError)return Response.json({error:'unavailable',message:'原恢复读取失败'},{status:503});
   if(path.endsWith('/database-generations'))return Response.json({active:{generationId,revision:1,restoreOperationId:null},items:[{id:generationId,resourceId:generationId,projectId,serviceId,env:'production',state:'active',origin:'existing',restoreOperationId:null,identity:null,createdAt:op.createdAt},{id:'01a1428f-eabe-7000-af4c-887037988564',resourceId:'01a1428f-eabe-7000-af4c-887037988564',projectId,serviceId,env:'development',state:'active',origin:'existing',restoreOperationId:null,identity:null,createdAt:op.createdAt}]});
   return Response.json(path.endsWith('/database-restores')?{items:state.items}:op);
  }
  return base(raw,init);
 }) as typeof fetch;
 return {delivery,op,state,writes};
}
