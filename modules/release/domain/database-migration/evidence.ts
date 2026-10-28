import { DatabaseMigrationApprovalRequestSchema, DatabaseMigrationPlanViewSchema, DatabaseMigrationReceiptSchema } from '@crewstation/contracts';
import { textHash } from '@crewstation/kernel';
export const MIGRATION_LOG_LIMIT=16*1024*1024;
/** AW canonicalSchemaJson: sorted keys, two-space indentation, and a trailing newline. */
export function migrationCanonical(value:unknown):string {
 return JSON.stringify(value,(_key,item:unknown)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item,2)+'\n';
}
export const migrationDigest=(value:unknown)=>'sha256:'+textHash(migrationCanonical(value));
export function parseMigrationMarker(log:string):{kind:'plan'|'receipt';text:string}|null {
 if(Buffer.byteLength(log)>MIGRATION_LOG_LIMIT)return null;
 const matches=[...log.matchAll(/^CS_DATABASE_MIGRATION_(PLAN|RECEIPT)=/gm)];if(matches.length!==1)return null;
 const match=matches[0]!,rest=log.slice(match.index!+match[0].length);
 try{
  if(match[1]==='PLAN'){
   const text=rest.split('\n')[0]!,parsed=JSON.parse(text);
   if(!DatabaseMigrationPlanViewSchema.safeParse(parsed).success&&!DatabaseMigrationApprovalRequestSchema.safeParse(parsed).success)return null;
   return {kind:'plan',text};
  }
  // Find the complete JSON value while preserving every byte, including its required final newline.
  let depth=0,quoted=false,escaped=false,end=-1;
  for(let i=0;i<rest.length;i++){
   const ch=rest[i];if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
   if(ch==='"')quoted=true;else if(ch==='{')depth++;else if(ch==='}'&&--depth===0){end=i+1;break;}
  }
  if(end<0||rest[end]!=='\n')return null;
  const text=rest.slice(0,end+1),receipt=DatabaseMigrationReceiptSchema.parse(JSON.parse(text));
  if(migrationCanonical(receipt)!==text||migrationDigest(receipt.payload)!==receipt.digest)return null;
  return {kind:'receipt',text};
 }catch{return null;}
}
