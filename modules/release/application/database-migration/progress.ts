import { isPlatformError } from '@crewstation/kernel';
import type { DatabaseMigrationOperation } from '../../domain/database-migration/operation';
import { migrationEnded } from '../../domain/database-migration/operation';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { restoreFailureBlocks } from '../database-restore/progress';
import { migrationContext } from './context';
import { buildMigrationCandidate } from './build';
import { progressMigrationJob } from './jobs';
import { freezeForMigration, migrationBarrier } from './freeze';
import { activateMigration } from './activate';
import { finishMigration, openMigration } from './finish';
async function step(deps:ReleaseUseCaseDeps,op:DatabaseMigrationOperation){
 const c=migrationContext(deps);
 if(op.abandonRequested||['rolling-back','completing'].includes(op.stage))return finishMigration(deps,op);
 if(op.stage==='requested'){
  await c.database.reserveMigration!({id:op.targetGenerationId,scratchId:op.scratchGenerationId,operationId:op.id,serviceId:op.serviceId,expectedGenerationId:op.sourceGenerationId,expectedRevision:op.sourceBindingRevision});return c.save(op,{stage:'provisioning'});
 }
 if(op.stage==='provisioning'){
  const target=await c.database.prepare(op.serviceId,op.id,op.targetGenerationId),scratch=await c.database.prepare(op.serviceId,op.id,op.scratchGenerationId);
  return target.ready&&scratch.ready?c.save(op,{stage:'building'}):op;
 }
 if(op.stage==='building')return buildMigrationCandidate(deps,op);
 if(op.stage==='planning')return progressMigrationJob(deps,op,'database-migration-plan');
 if(op.stage==='freezing')return freezeForMigration(deps,op);
 if(op.stage==='migrating'){await migrationBarrier(deps,op);return progressMigrationJob(deps,op,'database-migration-run');}
 if(op.stage==='activating')return activateMigration(deps,op);
 if(op.stage==='verifying'){await migrationBarrier(deps,op);return progressMigrationJob(deps,op,'database-migration-verify');}
 if(op.stage==='opening')return openMigration(deps,op);
 return op;
}
export function databaseMigrationProgress(deps:ReleaseUseCaseDeps){
 let afterId:string|undefined,inFlight:Promise<number>|undefined;
 const run=async()=>{
  if(!deps.databaseMigration)return 0;const c=migrationContext(deps),page=await c.store.pending(20,afterId);afterId=page.length===20?page.at(-1)!.id:undefined;
  let count=0;
  for(const candidate of page){
   try{await c.work(candidate.serviceId,candidate.id,{operationId:candidate.id},async()=>{
    const op=await c.load(candidate.serviceId,candidate.id);
    for(const a of [...op.previousAttempts,...(op.currentAttempt?[op.currentAttempt]:[])])if(a.proof&&['succeeded','failed'].includes(a.proof.receipt.state))await deps.uow.run(s=>s.ledger!.restoreJobObserved(a.jobId));
    if(migrationEnded(op)||op.error&&!op.abandonRequested)return;
    try{const next=await step(deps,op);if(next.observation)await c.save(next,{observation:null});count++;}
    catch(error){const current=await c.load(op.serviceId,op.id);if(migrationEnded(current)||current.error)return;
     const message=isPlatformError(error)?error.message.slice(0,1000):'迁移外部状态暂不可确认，平台会自动重新观察';
     if(restoreFailureBlocks(error))await c.save(current,{error:message,observation:null});
     else if(!current.observation||current.observation.message!==message||deps.clock.now().getTime()-Date.parse(current.observation.at)>=60_000)await c.save(current,{observation:{message,at:deps.clock.now().toISOString(),failures:(current.observation?.failures??0)+1}});
    }
   });}catch(error){deps.logger.warn('database migration admission unavailable',{operationId:candidate.id,error:isPlatformError(error)?error.kind:'unavailable'});}
  }
  return count;
 };
 return ()=>{inFlight??=run().finally(()=>{inFlight=undefined;});return inFlight;};
}
