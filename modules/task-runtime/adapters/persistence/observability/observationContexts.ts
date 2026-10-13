import {and,eq,inArray} from 'drizzle-orm';
import type {Executor} from '@crewstation/persistence';
import type {ProjectId,ServiceId,TaskId} from '@crewstation/contracts';
import {environments} from '../tables';
/** Original owner metadata only, through the caller's original snapshot. No runner token, render, image material or command. */
export async function readDevelopmentParentObservationContexts(db:Executor,ids:readonly string[]){if(!ids.length)return [];const rows=await db.select({id:environments.id,projectId:environments.projectId,serviceId:environments.serviceId,traceId:environments.traceId}).from(environments).where(and(inArray(environments.id,[...new Set(ids)]),eq(environments.kind,'dev-session')));return rows.map(row=>({...row,id:row.id as TaskId,projectId:row.projectId as ProjectId,serviceId:row.serviceId as ServiceId}));}
