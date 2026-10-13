import type { RuntimeFragment, RuntimePhase } from '@crewstation/contracts';
import type {NativeActivityEvent} from '@crewstation/contracts';
import type {RuntimeTaskHeaderFact,RuntimeAttemptFact,RuntimeFactQuery} from '@crewstation/contracts';
import type {CompleteSourceReader} from './completeReport';
/** Public owner headers and children always read through the same original snapshot executor. */
export interface CompleteRuntimeFactSources {
  readonly tasks:Readonly<Record<'business-task'|'development-agent',CompleteSourceReader<RuntimeTaskHeaderFact>>&Partial<Record<'development-cli',CompleteSourceReader<RuntimeTaskHeaderFact>>>>;
  fragments?(task:RuntimeTaskHeaderFact):CompleteSourceReader<RuntimeFragment>|undefined;
  lifecycle?(task:RuntimeTaskHeaderFact,asOf:string):Promise<readonly RuntimePhase[]>;
  attempts(task:RuntimeTaskHeaderFact):CompleteSourceReader<RuntimeAttemptFact>;
  activity?(task:RuntimeTaskHeaderFact):CompleteSourceReader<NativeActivityEvent>|undefined;
  projectName(id:string):Promise<string|null>;
  profileName(id:string):Promise<string|null>;
}
export type CompleteRuntimeFactSourceFactory<Snapshot>=(executor:Snapshot,query:RuntimeFactQuery,snapshotId:string)=>CompleteRuntimeFactSources;
