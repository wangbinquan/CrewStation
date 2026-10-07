import {fixedClock} from '@crewstation/kernel';
import type {Database} from '@crewstation/persistence';
import type {DevelopmentEndingSession} from '../../ports/developmentEnding';
import {developmentEndingStore} from '../../adapters/persistence/ending/store';
import {developmentObservationProducer} from '../../application/development/observationProducer';
import {workspaceFixture} from '../workspaceFixture';
import {nativeObservationFixture} from './fixture';
/** Actual original PG stores, with an explicitly simulated Session/credential transport. */
export async function observationProducerFixture(db:Database,options:{prepared?:boolean;bound?:boolean}={}){
 const f=await nativeObservationFixture(db,options),deps=workspaceFixture().deps;
 const issues:Parameters<typeof deps.credentials.issueDevSessionToken>[0][]=[],materialRefs:Parameters<typeof deps.compute.launchMaterial>[0][]=[],materialOrder:{registered:boolean;empty:boolean}[]=[];
 const materialControl={changedLaunch:false};
 deps.clock=fixedClock('2026-09-30T00:20:00.000Z');deps.environments.getEnvironment=f.environmentPort.getEnvironment;
 deps.credentials.issueDevSessionToken=async binding=>{issues.push(structuredClone(binding));return {token:'new-test-credential-'+issues.length,expiresAt:'2026-09-30T00:30:00.000Z'};};
 deps.compute.launchMaterial=async ref=>{materialRefs.push(structuredClone(ref));materialOrder.push({registered:f.stored.has(f.child.id),empty:f.control.info.receipt===null});
  const intent=f.preparation.intent;return {id:intent.profileId,name:'Original compute',revision:intent.profileRevision,protocol:intent.launch.protocol,image:f.start.execution.image,launch:{...intent.launch,...(materialControl.changedLaunch?{model:'provider/another-model'}:{})},beforeStart:{profile:intent.profileId,revision:intent.profileRevision,contentHash:'original-content',steps:[],vars:{},secrets:{synthetic:'only-this-command'},configFile:{kind:'none'},captureOutput:false}};};
 const ending:DevelopmentEndingSession={registerDevelopmentUsage:f.session.registerDevelopmentUsage,sendCommand:f.session.sendCommand,requestDevelopmentUsageDrain:async()=>{throw Error('producer admission must not authorize or simulate cleanup');}};
 const endingStore=developmentEndingStore(db,deps.clock),ports={owner:f.owner,dispatch:f.session,ending,store:endingStore};
 return {...f,applicationDeps:deps,ports,endingStore,issues,materialRefs,materialOrder,materialControl,producer:developmentObservationProducer(deps,ports)};
}
