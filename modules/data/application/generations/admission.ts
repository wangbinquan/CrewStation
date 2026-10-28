import type { ServiceId } from '@crewstation/contracts';
import type { DatabaseGenerations } from '../../ports/repositories';
/** The release owner also reserves requested operations before the controller creates physical generations. */
export function generationReservationGuard(store:DatabaseGenerations,assertAvailable?:(serviceId:ServiceId)=>Promise<void>):DatabaseGenerations{
 if(!assertAvailable)return store;
 return {...store,
  assertUnreserved:async id=>{await assertAvailable(id);await store.assertUnreserved(id);},
  withUnreserved:(id,effect)=>store.withUnreserved(id,async()=>{await assertAvailable(id);return effect();}),
  reserve:async input=>{await assertAvailable(input.serviceId);return store.reserve(input);},
 };
}
