import type {RuntimeAttemptFact,RuntimeTaskHeaderFact,RuntimeOwnerPage,RuntimeOwnerPageQuery} from '@crewstation/contracts';
export interface CompleteRuntimeFactOwner<Snapshot> {
  tasks(executor:Snapshot,query:RuntimeOwnerPageQuery):Promise<RuntimeOwnerPage<RuntimeTaskHeaderFact>>;
  attempts(executor:Snapshot,query:RuntimeOwnerPageQuery&{readonly taskId:string}):Promise<RuntimeOwnerPage<RuntimeAttemptFact>>;
}
export interface CompleteRuntimeFactOwners<Snapshot> {
  readonly business:CompleteRuntimeFactOwner<Snapshot>;
  readonly development:CompleteRuntimeFactOwner<Snapshot>;
  projectName(executor:Snapshot,id:string):Promise<string|null>;
  profileName(executor:Snapshot,id:string):Promise<string|null>;
}
