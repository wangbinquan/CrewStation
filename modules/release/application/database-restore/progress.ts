import { isPlatformError } from '@crewstation/kernel';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { restoreContext } from './context';
import { freezeRestoreEnvironment, progressRestoreJob } from './jobs';
import { freezeForRestore, readyRestoreCandidate, switchRestoreCandidate } from './cutover';
export function databaseRestoreProgress(deps:ReleaseUseCaseDeps){
  let afterId:string|undefined,inFlight:Promise<number>|undefined;
  const run=async()=>{
    if(!deps.databaseRestore)return 0;
    const c=restoreContext(deps),page=await c.store.pending(20,afterId);afterId=page.length===20?page.at(-1)!.id:undefined;
    let count=0;
    for(const candidate of page){
      try{await c.work(candidate.serviceId,candidate.id,{operationId:candidate.id},async()=>{
        let op=await c.load(candidate.serviceId,candidate.id);for(const [jobId,proof] of [[op.restoreJobId,op.restoreProof],[op.verifyJobId,op.verifyProof]] as const){if(proof&&['succeeded','failed'].includes(proof.receipt.state))await deps.uow.run(scope=>scope.ledger!.restoreJobObserved(jobId));}if(op.error||op.stage==='completed'||op.stage==='ready-to-switch')return;
        try{
          if(op.stage==='requested'){await c.database.reserve({id:op.targetGenerationId,operationId:op.id,serviceId:op.serviceId,expectedGenerationId:op.sourceGenerationId,expectedRevision:op.sourceBindingRevision});await c.save(op,{stage:'provisioning'});}
          else if(op.stage==='provisioning'){const target=await c.database.prepare(op.serviceId,op.id,op.targetGenerationId);if(target.ready){op=await freezeRestoreEnvironment(deps,op);await c.save(op,{stage:'restoring'});}}
          else if(op.stage==='restoring'||op.stage==='verifying')await progressRestoreJob(deps,op,op.stage==='restoring'?'database-restore':'database-verify');
          else if(op.stage==='freezing')await freezeForRestore(deps,op);
          else if(op.stage==='deploying')await readyRestoreCandidate(deps,op);
          else if(op.stage==='switching')await switchRestoreCandidate(deps,op);
          count++;
        }catch(error){const current=await c.load(op.serviceId,op.id);if(current.stage!=='completed'&&!current.error)await c.save(current,{error:isPlatformError(error)?error.message.slice(0,1000):'原恢复外部状态暂不可确认；请在原操作中重试观察'});}
      });}catch(error){deps.logger.warn('database restore admission unavailable',{operationId:candidate.id,error:isPlatformError(error)?error.kind:'unavailable'});}
    }
    return count;
  };
  return ()=>{inFlight??=run().finally(()=>{inFlight=undefined;});return inFlight;};
}
