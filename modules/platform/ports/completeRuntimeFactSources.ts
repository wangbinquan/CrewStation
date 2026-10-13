import type { RuntimeFragment, RuntimePhase } from '@crewstation/contracts';
import type {NativeActivityEvent} from '@crewstation/contracts';
import type {RuntimeAttemptFact,RuntimeTaskHeaderFact,RuntimeOwnerPage,RuntimeOwnerPageQuery} from '@crewstation/contracts';
export interface CompleteRuntimeFactOwner<Snapshot> {
  tasks(executor:Snapshot,query:RuntimeOwnerPageQuery):Promise<RuntimeOwnerPage<RuntimeTaskHeaderFact>>;
  attempts(executor:Snapshot,query:RuntimeOwnerPageQuery&{readonly taskId:string}):Promise<RuntimeOwnerPage<RuntimeAttemptFact>>;
}
export interface CompleteRuntimeFactOwners<Snapshot> {
  readonly business:CompleteRuntimeFactOwner<Snapshot>;
  readonly development:CompleteRuntimeFactOwner<Snapshot>;
  readonly cli?:CompleteRuntimeFactOwner<Snapshot>;
  fragments?(executor:Snapshot,task:RuntimeTaskHeaderFact,after:string|undefined):Promise<{items:readonly RuntimeFragment[];nextCursor:string|null}>;
  lifecycle?(executor:Snapshot,task:RuntimeTaskHeaderFact,asOf:string):Promise<readonly RuntimePhase[]>;
  cliActivity?(executor:Snapshot,task:RuntimeTaskHeaderFact,after:number|undefined):Promise<{items:readonly {sequence:number;event:NativeActivityEvent}[];nextCursor:number|null}>;
  projectName(executor:Snapshot,id:string):Promise<string|null>;
  profileName(executor:Snapshot,id:string):Promise<string|null>;
}
