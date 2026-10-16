import {CreateDatabaseRestoreSchema} from '@crewstation/contracts';
import type {CreateDatabaseRestore} from '@crewstation/contracts';
export const restoreIntentKey=(serviceId:string,userId:string)=>`cs.database-restore:${userId}:${serviceId}`;
export function readRestoreIntent(storage:Pick<Storage,'getItem'>,key:string):{intent:CreateDatabaseRestore|null;error:string|null}{
 try {const raw=storage.getItem(key);return {intent:raw?CreateDatabaseRestoreSchema.parse(JSON.parse(raw)):null,error:null};}
 catch{return {intent:null,error:'release.restore.intentUnavailable'};}
}
export function saveRestoreIntent(storage:Pick<Storage,'setItem'>,key:string,input:CreateDatabaseRestore){
 storage.setItem(key,JSON.stringify(CreateDatabaseRestoreSchema.parse(input)));
}
export function clearRestoreIntent(storage:Pick<Storage,'getItem'|'removeItem'>,key:string,requestId:string){
 const original=readRestoreIntent(storage,key);if(original.error)throw new Error(original.error);
 if(original.intent?.requestId===requestId)storage.removeItem(key);
}
