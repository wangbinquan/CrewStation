import type {RuntimeFactQuery,RuntimeTaskHeaderFact,RuntimeOwnerPage,RuntimeOwnerPageQuery,RuntimeSourceKind} from '@crewstation/contracts';
import {jsonHash,validation} from '@crewstation/kernel';
import type {CompleteRuntimeFactOwners} from '../ports/completeRuntimeFactSources';
/** Per-page sizes only bound transport. Source progress continues until each original owner EOF. */
export function completeRuntimeFactSources<Snapshot>(owners:CompleteRuntimeFactOwners<Snapshot>) {
  return (executor:Snapshot,query:RuntimeFactQuery,snapshotId:string)=>{
    if(!snapshotId) throw validation('原运行快照身份缺失');
    const reader=<T>(source:string,filters:RuntimeFactQuery,read:(query:RuntimeOwnerPageQuery)=>Promise<RuntimeOwnerPage<T>>)=>{
      const scope=jsonHash(filters);
      return {next:async(cursor:string|null)=>{
        let after:string|undefined;
        if(cursor!==null) {
          let value:unknown;try{value=JSON.parse(cursor);}catch{throw validation('原运行分页游标无效');}
          if(!Array.isArray(value)||value.length!==4||value[0]!==snapshotId||value[1]!==source||value[2]!==scope||typeof value[3]!=='string'||!value[3]) throw validation('原运行分页游标快照、来源或范围已改变');
          after=value[3];
        }
        const page=await read({...filters,pageSize:100,...(after===undefined?{}:{after})});
        return {...page,snapshotId,nextCursor:page.nextCursor===null?null:JSON.stringify([snapshotId,source,scope,page.nextCursor])};
      }};
    };
    const source=(kind:RuntimeSourceKind)=>kind==='business-task'?owners.business:kind==='development-cli'?owners.cli:owners.development;
    const taskReader=(kind:RuntimeSourceKind)=>query.sourceKind&&query.sourceKind!==kind?{next:async()=>({items:[],snapshotId,nextCursor:null})}:reader('tasks/'+kind,query,(filters)=>source(kind)!.tasks(executor,{...filters,sourceKind:kind}));
    return {tasks:{'business-task':taskReader('business-task'),'development-agent':taskReader('development-agent'),...(owners.cli?{'development-cli':taskReader('development-cli')}: {})},
      attempts:(task:RuntimeTaskHeaderFact)=>reader('attempts/'+task.id,{...query,projectId:task.projectId,taskId:task.id},(filters)=>source(task.source?.kind??'business-task')!.attempts(executor,{...filters,taskId:task.id})),
      ...(owners.cliActivity?{activity:(task:RuntimeTaskHeaderFact)=>task.source?.kind!=='development-cli'?undefined:{next:async(cursor:string|null)=>{const after=cursor===null?undefined:Number(cursor);if(after!==undefined&&(!Number.isSafeInteger(after)||after<0))throw validation('CLI 活动序号无效');const page=await owners.cliActivity!(executor,task,after);return {items:page.items.map(row=>row.event),snapshotId,nextCursor:page.nextCursor===null?null:String(page.nextCursor)};}}}:{}),
      ...(owners.fragments?{fragments:(task:RuntimeTaskHeaderFact)=>({next:async(cursor:string|null)=>{const after=cursor??undefined;return {...await owners.fragments!(executor,task,after),snapshotId};}})}:{}),
      ...(owners.lifecycle?{lifecycle:(task:RuntimeTaskHeaderFact,asOf:string)=>owners.lifecycle!(executor,task,asOf)}:{}),
      projectName:(id:string)=>owners.projectName(executor,id),profileName:(id:string)=>owners.profileName(executor,id),
    };
  };
}
