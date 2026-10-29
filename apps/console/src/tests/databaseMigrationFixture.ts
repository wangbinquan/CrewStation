import { DatabaseMigrationDtoSchema } from '@crewstation/contracts';
import { projectId,serviceId,userId,prodId,targetId,releaseDeliveryFixture } from './releaseDeliveryFixture';
export const operationId='01a1428f-eabe-7000-af4c-887037988581',generationId='01a1428f-eabe-7000-af4c-887037988582',migratedId='01a1428f-eabe-7000-af4c-887037988583',scratchId='01a1428f-eabe-7000-af4c-887037988584';
export function databaseMigrationFixture(){
 const delivery=releaseDeliveryFixture();delivery.state.admin=true;const base=globalThis.fetch,digest='sha256:'+'b'.repeat(64);
 const op=DatabaseMigrationDtoSchema.parse({id:operationId,projectId,serviceId,revision:5,stage:'approved',sourceGenerationId:generationId,targetGenerationId:migratedId,scratchGenerationId:scratchId,sourceReleaseId:prodId,candidateReleaseId:targetId,branch:'main',commitSha:'a'.repeat(40),candidateTag:'v0.0.3+migrate.fixture',image:'registry/app@sha256:'+'a'.repeat(64),plan:{operationId:'dbm_e2_fixture1',plan:{payload:{source:{provider:'postgresql',epoch:1},target:{generationId:'dbg_'+'a'.repeat(32),location:{kind:'postgresql-target',profileRef:'crewstation:target'}},blocks:[],estimates:{requiredBytes:1024}},digest,approvalDigest:digest},jsonPath:null,markdownPath:null,acknowledgeable:[],requiresApproval:true,guidance:[]},approval:{digest,by:userId,at:'2026-10-28T00:00:00.000Z'},confirmationDigest:'d'.repeat(64),actions:['switch','abandon'],blockedReason:null,error:null,observation:null,attempts:[],createdBy:userId,createdAt:'2026-10-28T00:00:00.000Z',updatedAt:'2026-10-28T00:00:00.000Z'});
 const state={readError:false,loseResponse:false,wrongResponse:false,items:[op]},writes:Array<{path:string;body:Record<string,unknown>}>=[];
 globalThis.fetch=(async(raw,init)=>{
  const path=new URL(String(raw),'http://localhost').pathname,method=init?.method??'GET';
  if(path.includes('/database-migrations')||path.endsWith('/database-generations')){
   if(method!=='GET'){const body=JSON.parse(String(init?.body??'{}')) as Record<string,unknown>;writes.push({path,body});if(state.loseResponse)throw new TypeError('response lost');
    if(path.endsWith('/database-migrations'))return Response.json({...op,...body,id:state.wrongResponse?Bun.randomUUIDv7():body.requestId,sourceGenerationId:body.expectedActiveGenerationId,sourceReleaseId:body.expectedActiveReleaseId,commitSha:body.expectedCommitSha,stage:'requested',actions:['abandon'],confirmationDigest:null,expectedActiveGenerationId:undefined,expectedActiveReleaseId:undefined,expectedCommitSha:undefined,requestId:undefined});
    if(path.endsWith('/cancel-rollback')){Object.assign(op,{stage:'ready-to-open',revision:op.revision+1,error:null,observation:null,actions:['open','rollback'],confirmationDigest:'e'.repeat(64)});return Response.json(op);}
    return Response.json({...op,revision:op.revision+1,actions:[],confirmationDigest:null});}
   if(state.readError)return Response.json({error:'unavailable',message:'迁移读取失败'},{status:503});
   if(path.endsWith('/database-generations'))return Response.json({active:{generationId,revision:1,restoreOperationId:null,migrationOperationId:null},items:[]});
   if(path.endsWith('/plan'))return Response.json({markdown:'# Migration'});
   return Response.json(path.endsWith('/database-migrations')?{items:state.items}:op);
  }
  return base(raw,init);
 }) as typeof fetch;
 return {delivery,op,state,writes};
}
