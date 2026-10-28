import { expect,test } from 'bun:test';
import { conflict } from '@crewstation/kernel';
import type { ServiceId } from '@crewstation/contracts';
import type { DatabaseGenerations } from '../../ports/repositories';
import { generationReservationGuard } from './admission';
test('requested release migration blocks grants, rotation and restore even before the physical reservation exists',async()=>{
 let active=true,writes=0;const id=Bun.randomUUIDv7() as ServiceId;
 const store={assertUnreserved:async()=>{},withUnreserved:async(_id:string,effect:()=>Promise<unknown>)=>effect(),reserve:async()=>{writes++;return {};}} as unknown as DatabaseGenerations;
 const guarded=generationReservationGuard(store,async()=>{if(active)throw conflict('migration active',{code:'database_migration_active'});});
 await expect(guarded.assertUnreserved(id)).rejects.toMatchObject({details:{code:'database_migration_active'}});await expect(guarded.withUnreserved(id,async()=>{writes++;})).rejects.toThrow('migration active');await expect(guarded.reserve({serviceId:id} as never)).rejects.toThrow('migration active');expect(writes).toBe(0);active=false;await guarded.reserve({serviceId:id} as never);expect(writes).toBe(1);
});
