import {CreateDatabaseMigrationSchema} from '@crewstation/contracts';
import type {CreateDatabaseMigration} from '@crewstation/contracts';
export const migrationIntentKey=(serviceId:string,userId:string)=>`cs.database-migration:${userId}:${serviceId}`;
export function readMigrationIntent(storage:Pick<Storage,'getItem'>,key:string):{intent:CreateDatabaseMigration|null;error:string|null}{
 try {const raw=storage.getItem(key);return {intent:raw?CreateDatabaseMigrationSchema.parse(JSON.parse(raw)):null,error:null};}
 catch{return {intent:null,error:'release.migration.intentUnavailable'};}
}
export function saveMigrationIntent(storage:Pick<Storage,'setItem'>,key:string,input:CreateDatabaseMigration){
 storage.setItem(key,JSON.stringify(CreateDatabaseMigrationSchema.parse(input)));
}
export function clearMigrationIntent(storage:Pick<Storage,'getItem'|'removeItem'>,key:string,requestId:string){
 const original=readMigrationIntent(storage,key);if(original.error)throw new Error(original.error);
 if(original.intent?.requestId===requestId)storage.removeItem(key);
}
