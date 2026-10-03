import type {RuntimeTaskHeaderFact,RuntimeAttemptFact,RuntimeFactQuery,RuntimeSourceKind} from '@crewstation/contracts';
import type {CompleteSourceReader} from './completeReport';
/** Public owner headers and children always read through the same original snapshot executor. */
export interface CompleteRuntimeFactSources {
  readonly tasks:Readonly<Record<RuntimeSourceKind,CompleteSourceReader<RuntimeTaskHeaderFact>>>;
  attempts(task:RuntimeTaskHeaderFact):CompleteSourceReader<RuntimeAttemptFact>;
  projectName(id:string):Promise<string|null>;
  profileName(id:string):Promise<string|null>;
}
export type CompleteRuntimeFactSourceFactory<Snapshot>=(executor:Snapshot,query:RuntimeFactQuery,snapshotId:string)=>CompleteRuntimeFactSources;
