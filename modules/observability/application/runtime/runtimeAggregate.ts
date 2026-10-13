import {forbidden} from '@crewstation/kernel';
import {RuntimeStatisticsQuerySchema,type Actor,type ProjectId,type RuntimeStatisticsQuery} from '@crewstation/contracts';
import type {ProjectAuthorizer} from '../../ports/sources';
import type {RuntimeAggregate,RuntimeProjectionState} from '@crewstation/contracts';
export function runtimeAggregateQueries(input:{authorizer:ProjectAuthorizer;read:(id:ProjectId|null,query:RuntimeStatisticsQuery,collection:'available'|'validation-selected'|'production-disabled')=>Promise<RuntimeAggregate>;head:(projectId?:ProjectId|null)=>Promise<RuntimeProjectionState>;collection:(id:ProjectId|null)=>'available'|'validation-selected'|'production-disabled'}){
 const authorize=async(actor:Actor,id:ProjectId|null)=>{if(id)await input.authorizer.authorize(actor,id,'view');else if(!actor.isAdmin)throw forbidden();};
 return {summary:async(actor:Actor,id:ProjectId|null,query:RuntimeStatisticsQuery)=>{await authorize(actor,id);return input.read(id,RuntimeStatisticsQuerySchema.parse(query),input.collection(id));},head:async(actor:Actor,id:ProjectId|null)=>{await authorize(actor,id);return input.head(id);}};
}
