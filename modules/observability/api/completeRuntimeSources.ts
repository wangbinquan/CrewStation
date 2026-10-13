import type {NativeActivityEvent} from '@crewstation/contracts';
import type {RuntimeTaskHeaderFact,RuntimeAttemptFact,RuntimeFactQuery} from '@crewstation/contracts';
interface OriginalFactReader<T> {next(after:string|null):Promise<{readonly items:readonly T[];readonly snapshotId:string;readonly nextCursor:string|null}>}
/** Public owner headers and children always read through the same original snapshot executor. */
export interface CompleteRuntimeFactSources {
  readonly tasks:Readonly<Record<'business-task'|'development-agent',OriginalFactReader<RuntimeTaskHeaderFact>>&Partial<Record<'development-cli',OriginalFactReader<RuntimeTaskHeaderFact>>>>;
  attempts(task:RuntimeTaskHeaderFact):OriginalFactReader<RuntimeAttemptFact>;
  activity?(task:RuntimeTaskHeaderFact):OriginalFactReader<NativeActivityEvent>|undefined;
  projectName(id:string):Promise<string|null>;
  profileName(id:string):Promise<string|null>;
}
export type CompleteRuntimeFactSourceFactory<Snapshot>=(executor:Snapshot,query:RuntimeFactQuery,snapshotId:string)=>CompleteRuntimeFactSources;
