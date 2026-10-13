import {and,asc,eq,gt} from 'drizzle-orm';
import type {Executor} from '@crewstation/persistence';
import type {TaskId} from '@crewstation/contracts';
import {validation} from '@crewstation/kernel';
import {observationActivityHistory as history} from './observationActivityTable';
/** Exact original activity sequence, including source gaps; no text output or transient UI pruning. */
export async function readOriginalCliActivityPage(db:Executor,scope:{taskId:TaskId;agentId:string;sourceTaskId:TaskId},after:number|undefined,pageSize=200){if(!Number.isInteger(pageSize)||pageSize<1||pageSize>500||after!==undefined&&(!Number.isSafeInteger(after)||after<0))throw validation('CLI 活动页范围无效');const rows=await db.select({sequence:history.sourceSeq,event:history.document}).from(history).where(and(eq(history.taskId,scope.taskId),eq(history.agentId,scope.agentId),eq(history.sourceTaskId,scope.sourceTaskId),after===undefined?undefined:gt(history.sourceSeq,after))).orderBy(asc(history.sourceSeq)).limit(pageSize+1),items=rows.slice(0,pageSize);return {items,nextCursor:rows.length>pageSize?items.at(-1)!.sequence:null};}
