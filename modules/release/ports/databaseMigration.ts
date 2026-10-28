import type { ServiceId } from '@crewstation/contracts';
import type { DatabaseMigrationOperation, MigrationJobProof } from '../domain/database-migration/operation';
import type { DatabaseRestoreSupport, RestoreJobObserver } from './databaseRestore';
export interface DatabaseMigrationRepository {
 get(id:string):Promise<DatabaseMigrationOperation|undefined>;
 forJob(id:string):Promise<DatabaseMigrationOperation|undefined>;
 active(serviceId:ServiceId):Promise<DatabaseMigrationOperation|undefined>;
 list(serviceId:ServiceId):Promise<DatabaseMigrationOperation[]>;
 pending(limit:number,afterId?:string):Promise<DatabaseMigrationOperation[]>;
 insert(op:DatabaseMigrationOperation):Promise<void>;
 save(original:DatabaseMigrationOperation,next:DatabaseMigrationOperation):Promise<void>;
 artifact(id:string,name:string):Promise<{bytes:string;digest:string}|null>;
 writeArtifact(id:string,name:string,digest:string,bytes:string):Promise<{digest:string;bytes:number}>;
}
export interface MigrationJobObserver {
 candidate:RestoreJobObserver['candidate'];
 observe(input:Omit<Parameters<RestoreJobObserver['observe']>[0],'purpose'|'previous'> & {purpose:NonNullable<DatabaseMigrationOperation['currentAttempt']>['purpose'];previous:MigrationJobProof|null}):Promise<MigrationJobProof|null>;
}
export interface DatabaseMigrationSupport extends Omit<DatabaseRestoreSupport,'jobs'> { jobs:MigrationJobObserver; controlUrl:string }
