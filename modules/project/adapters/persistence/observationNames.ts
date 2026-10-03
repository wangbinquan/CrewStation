import {eq} from 'drizzle-orm';
import type {Executor} from '@crewstation/persistence';
import {projects} from './tables';
/** A display-only owner fact read in the caller's original report snapshot. */
export async function readProjectObservationName(db:Executor,id:string):Promise<string|null> {
  return (await db.select({name:projects.name}).from(projects).where(eq(projects.id,id)).limit(1))[0]?.name??null;
}
