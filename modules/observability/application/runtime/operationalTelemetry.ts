import type {Actor,OperationalTelemetry,OperationalTelemetryQuery,ProjectId} from '@crewstation/contracts';
import {OperationalTelemetryQuerySchema} from '@crewstation/contracts';
import {forbidden,notFound} from '@crewstation/kernel';
import type {ProjectAuthorizer,ServiceResolver} from '../../ports/sources';
import type {OperationalMetricSource} from '../../ports/operationalTelemetry';
import {operationalTelemetryRows} from '../../domain/runtime/operationalTelemetry';
export function operationalTelemetryQueries(input:{source?:OperationalMetricSource;authorizer:ProjectAuthorizer;services:ServiceResolver}) {
 return async(actor:Actor,projectId:ProjectId|null,raw:OperationalTelemetryQuery):Promise<OperationalTelemetry>=>{
  const query=OperationalTelemetryQuerySchema.parse(raw);let namespace:string|undefined,projectSlug:string|undefined;
  if(projectId){await input.authorizer.authorize(actor,projectId,'view');const service=await input.services.resolveServiceOfProject(projectId);if(!service)throw notFound('项目服务',projectId);namespace=service.namespace;projectSlug=service.slug;}else if(!actor.isAdmin)throw forbidden();
  const base={scope:projectId?'project' as const:'system' as const,projectId,...query,source:'prometheus' as const};
  if(!input.source)return {...base,state:'unavailable',rows:[],observedAt:null,gaps:['source-not-configured']};
  try {const facts=operationalTelemetryRows(await input.source.read(query,namespace,projectSlug),query);const availableFrom=input.source.availableFrom?.();if(availableFrom&&Date.parse(query.from)<Date.parse(availableFrom))facts.gaps.push('source-retention-gap');const excluded=query.excludeMaintenance?facts.rows.filter(r=>r.plannedMaintenance===true).reduce((n,r)=>n+BigInt(r.requests),0n):0n;
   return {...base,...facts,...(availableFrom?{availableFrom}:{}),...(query.excludeMaintenance?{rows:facts.rows.filter(r=>r.plannedMaintenance!==true),excludedMaintenanceRequests:String(excluded)}:{}),state:facts.rows.length||facts.gauges.length?'partial':'no-samples'};}
  catch {return {...base,state:'error',rows:[],observedAt:null,gaps:['source-read-failed']};}
 };
}
