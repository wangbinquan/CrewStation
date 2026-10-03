import {eq} from 'drizzle-orm';
import type {Executor} from '@crewstation/persistence';
import {profiles} from './tables';
/** Names use the same original snapshot; accepted profile revisions stay accounting keys. */
export async function readProfileObservationName(db:Executor,id:string):Promise<string|null> {
  return (await db.select({name:profiles.name}).from(profiles).where(eq(profiles.id,id)).limit(1))[0]?.name??null;
}
