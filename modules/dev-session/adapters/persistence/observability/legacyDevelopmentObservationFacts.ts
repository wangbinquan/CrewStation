import {sql} from 'drizzle-orm';
import type {Executor} from '@crewstation/persistence';
import {DevelopmentAgentIdentitySchema,RuntimeTaskFactSchema,type RuntimeFactQuery,type RuntimeTaskFact,type ProjectId,type ServiceId,type TaskId} from '@crewstation/contracts';
import {conflict} from '@crewstation/kernel';
export type OriginalDevelopmentParentReader=(ids:readonly string[])=>Promise<readonly {id:TaskId;projectId:ProjectId;serviceId:ServiceId;traceId:string|null}[]>;
/** Source rows exist even when an old or unsupported execution has no numerical preparation. Missing preparation is a usage gap, never permission to drop that Task. */
export async function legacyDevelopmentObservationRows(db:Executor,query:RuntimeFactQuery,pageSize:number,parents:OriginalDevelopmentParentReader|undefined,position?:{at:string;id:string}){
 if(!parents||query.sourceKind==='business-task')return [];
 const found:Array<Record<string,unknown>>=[];let after=position;
 while(found.length<=pageSize){const rows=await db.execute(sql`SELECT s.agent_id,s.task_id,s.execution_task_id,s.execution->>'taskId' AS execution_id,s.compute,s.compute_name,s.profile,s.state,s.cancelled,s.failure,s.logical_ending,s.created_at AS accepted_at,
  to_char(s.created_at::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS position_at
  FROM dev_session.agent_starts s WHERE NOT EXISTS(SELECT 1 FROM dev_session.development_agent_usage o WHERE o.execution_task_id=s.execution_task_id)
   AND ${query.taskId?sql`s.execution_task_id=${query.taskId}`:sql`s.created_at::timestamptz>=${query.from}::timestamptz AND s.created_at::timestamptz<${query.to}::timestamptz`}
   AND ${after?sql`s.created_at::timestamptz<${after.at}::timestamptz OR (s.created_at::timestamptz=${after.at}::timestamptz AND s.execution_task_id>${after.id})`:sql`true`}
  ORDER BY s.created_at::timestamptz DESC,s.execution_task_id LIMIT 200`);
  if(!rows.length)break;const owners=new Map((await parents(rows.map(row=>String(row['task_id'])))).map(row=>[row.id as string,row]));
  for(const row of rows){const parent=owners.get(String(row['task_id']));if(!parent)throw conflict('开发执行的原父工作区归属不可用，不能丢弃执行或伪造项目');if(query.projectId&&parent.projectId!==query.projectId)continue;found.push({...row,legacy_observation:true,parent});}
  const last=rows.at(-1)!;after={at:String(last['position_at']),id:String(last['execution_task_id'])};
 }
 return found.slice(0,pageSize+1);
}
export function legacyDevelopmentObservationFact(row:Record<string,unknown>):RuntimeTaskFact{
 const parent=row['parent'] as Awaited<ReturnType<OriginalDevelopmentParentReader>>[number],profile=row['profile'] as {profileId?:string;revision?:number};
 if(row['execution_id']!==row['execution_task_id']||profile.profileId!==row['compute']||!Number.isSafeInteger(profile.revision)||!profile.revision)throw conflict('开发执行的原受理身份或固定算力修订不一致');
 const identity=DevelopmentAgentIdentitySchema.parse({sourceKind:'development-agent',projectId:parent.projectId,taskId:parent.id,agentId:row['agent_id'],executionId:row['execution_task_id'],executionGeneration:1}),at=new Date(String(row['accepted_at'])).toISOString();
 const state=row['cancelled']?'cancelled':row['failure']?'failed':row['logical_ending']||row['state']==='ended'?'closed':row['state']==='dispatched'?'running':'pending';
 const name=row['compute_name']?`Agent · ${String(row['compute_name'])}`:String(row['agent_id']);
 return RuntimeTaskFactSchema.parse({id:identity.executionId,projectId:parent.projectId,serviceId:parent.serviceId,name,source:{kind:'development-agent',identity,workspaceName:null},protocol:'development',state,createdAt:at,closedAt:null,traceId:parent.traceId,attemptsPartial:false,attempts:[{id:identity.agentId,taskId:parent.id,name,kind:'agent',state,attempt:1,executionId:identity.executionId,agentId:identity.agentId,profileId:profile.profileId,profileName:row['compute_name']??null,profileRevision:profile.revision,createdAt:at,startedAt:null,endedAt:null}]});
}
