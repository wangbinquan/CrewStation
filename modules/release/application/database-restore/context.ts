import type { Actor, ServiceId } from '@crewstation/contracts';
import { forbidden, notFound, precondition } from '@crewstation/kernel';
import type { DatabaseRestoreOperation } from '../../domain/databaseRestore';
import type { ReleaseUseCaseDeps } from '../dependencies';
import { releaseProjectWork } from '../projectDeletion';
export function restoreContext(deps: ReleaseUseCaseDeps) {
  const support=deps.databaseRestore, database=deps.data.databaseGenerations, store=deps.uow.read.databaseRestores;
  if(!support||!database||!store||!deps.uow.read.ledger||deps.creation!=='ledger')throw precondition('平台尚未配置独立数据库恢复');
  const authorize=async(actor:Actor,serviceId:ServiceId,write=true)=>{
    if(write&&(!actor.isAdmin||!await support.isAdmin(actor.userId)))throw forbidden('只有平台管理员可以管理数据库恢复');
    const service=await deps.services.resolveServiceById(serviceId);if(!service)throw notFound('服务',serviceId);
    await deps.authorizer.authorize(actor,service.projectId,write?'publish':'view');return service;
  };
  const load=async(serviceId:ServiceId,id:string)=>{const op=await store.get(id);if(!op||op.serviceId!==serviceId)throw notFound('数据库恢复',id);return op;};
  const save=async(op:DatabaseRestoreOperation,patch:Partial<DatabaseRestoreOperation>)=>{
    const next={...op,...patch,revision:op.revision+1,updatedAt:deps.clock.now().toISOString()};await store.save(op,next);return next;
  };
  const work=<T>(serviceId:ServiceId,id:string,body:unknown,effect:()=>Promise<T>)=>releaseProjectWork(deps,serviceId,'maintenance',id,body,()=>support.coordination.run(id,effect));
  return {support,database,store,authorize,load,save,work};
}
