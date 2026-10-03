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
    const source=(kind:RuntimeSourceKind)=>kind==='business-task'?owners.business:owners.development;
    const taskReader=(kind:RuntimeSourceKind)=>reader('tasks/'+kind,query,(filters)=>source(kind).tasks(executor,filters));
    return {tasks:{'business-task':taskReader('business-task'),'development-agent':taskReader('development-agent')},
      attempts:(task:RuntimeTaskHeaderFact)=>reader('attempts/'+task.id,{...query,projectId:task.projectId,taskId:task.id},(filters)=>source(task.source?.kind??'business-task').attempts(executor,{...filters,taskId:task.id})),
      projectName:(id:string)=>owners.projectName(executor,id),profileName:(id:string)=>owners.profileName(executor,id),
    };
  };
}
