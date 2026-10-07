import type {Database} from '@crewstation/persistence';
import type {AgentStart} from '../../ports/agentStarts';
import {developmentDispatchFixture} from '../developmentDispatchFixture';
/** Reuse the unchanged original PG/Session fixture; only this explicit new test admission selects native v2. */
export async function nativeObservationFixture(db:Database,options:{prepared?:boolean;bound?:boolean}={}) {
 const f=await developmentDispatchFixture(db,{selected:false});f.preparation.intent.nativeSource={version:2};
 const start:AgentStart={...f.start,execution:{...f.start.execution,observationIntent:f.preparation.intent}};await f.starts.update(start);
 if(options.prepared!==false)await f.owner.prepare(f.preparation);if(options.bound)await f.owner.bind(f.child.id,f.info);
 f.control.capabilities={...f.control.capabilities!,developmentNativePagesV2:2};
 return {...f,start};
}
