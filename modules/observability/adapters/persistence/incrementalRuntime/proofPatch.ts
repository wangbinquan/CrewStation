import {publishRuntimeSourceQuality} from './sourceQuality';
import {sql} from 'drizzle-orm';
import type {Database,Executor} from '@crewstation/persistence';
import {UsageNativeCaptureSchema,type RuntimeNativePagedCapture,type UsageNativeCapture} from '@crewstation/contracts';
import {jsonHash,newResourceId} from '@crewstation/kernel';
import type {IncrementalRuntimeTask} from '../../../ports/incrementalRuntimeTasks';
import type {CompleteAttemptWorking} from '../../../ports/completeRuntimeTask';
import {completeRuntimeMetrics,emptyCompleteRuntimeFold,mergeCompleteRuntimeFold} from '../../../domain/completeRuntimeMetrics';
import {runtimeNativeQuality,RUNTIME_NATIVE_GAPS} from '../../../domain/runtime/runtimeNativeQuality';
import {assertCompleteObserved} from '../../../domain/completeRuntimeIdentity';
import {admitRuntimeReport} from '../reports/reportAdmission';
import {admitObservationWrite} from '../projectDeletion';
import {readNativeReportCapture} from '../developmentUsage/nativeReportCaptures';
import {putRuntimeRow,runtimeRowSequence} from './rowVersions';
import {patchRuntimeQuality} from './qualityRows';
import {publishRuntimeScope} from './scopePublication';
import {applyRuntimeDailyDeltas} from '../projection/runtimeDailyAggregate';
import {runtimeDailyDeltas} from '../../../domain/runtime/runtimeDailyDelta';
class ProofQualificationRequired extends Error {}
async function readAttempt(tx:Executor,id:string,key:string){const [row]=await tx.execute(sql`SELECT document FROM observability.runtime_task_current_rows WHERE task_id=${id} AND role='attempts' AND key=${key}`);return row?.['document'] as CompleteAttemptWorking|undefined;}
export async function qualifyRuntimeAttemptProof(tx:Executor,id:string,key:string,sequence:string){
 const original=await readAttempt(tx,id,key);if(!original||original.attempt.kind!=='agent')throw Error('Original proof attempt missing');
 const [proof]=await tx.execute(sql`SELECT count(*) FILTER(WHERE document->>'included'='true')::text AS captures,count(*) FILTER(WHERE document->>'included'='true' AND document->>'complete'='false')::text AS incomplete,count(*) FILTER(WHERE document->>'included'='true' AND document->>'empty'='false')::text AS nonempty FROM observability.runtime_task_current_rows WHERE task_id=${id} AND role='capture-quality' AND document->>'attemptKey'=${key}`),[links]=await tx.execute(sql`SELECT count(*)::text AS count,count(*) FILTER(WHERE c.key IS NULL OR c.document->>'complete'='false')::text AS missing FROM observability.runtime_task_current_rows l LEFT JOIN observability.runtime_task_current_rows c ON c.task_id=l.task_id AND c.role='capture-quality' AND c.key=l.document->>'captureKey' WHERE l.task_id=${id} AND l.role='proof-links' AND l.document->>'attemptKey'=${key}`);
 if(links?.['count']!==original.rawUsage)throw new ProofQualificationRequired('Original selected record links do not cover the raw attempt');
 const next=structuredClone(original);next.captures=String(proof!['captures']);next.nativeComplete=proof!['incomplete']==='0';next.nativeEmpty=proof!['nonempty']==='0';next.fold.gaps=next.fold.gaps.filter(g=>!RUNTIME_NATIVE_GAPS.some(n=>n===g));
 if(next.captures==='0'||links?.['missing']!=='0')next.fold.gaps.push('native-capture-unobserved');if(!next.nativeComplete)next.fold.gaps.push('native-capture-incomplete');
 if(next.rawUsage==='0'){if(next.captures==='0'||!next.nativeComplete||!next.nativeEmpty)next.fold.gaps.push('usage-missing');else next.fold.observedExecutions='1';}else next.fold.observedExecutions='1';
 await putRuntimeRow(tx,id,sequence,'attempts',key,next);
 const [summary]=await tx.execute(sql`SELECT document FROM observability.runtime_task_current_rows WHERE task_id=${id} AND role='attempt-summaries' AND key=${key}`);await putRuntimeRow(tx,id,sequence,'attempt-summaries',key,{...(summary?.['document'] as object),metrics:completeRuntimeMetrics(next.fold)});
 const publicRows=await tx.execute(sql`SELECT key,document FROM observability.runtime_task_current_rows WHERE task_id=${id} AND role='public-rows' AND document->>'section' IN('attempts','swimlane') AND document->>'key'=${key}`);for(const r of publicRows){const document=r['document'] as {document:Record<string,unknown>};await putRuntimeRow(tx,id,sequence,'public-rows',String(r['key']),{...document,document:{...document.document,metrics:completeRuntimeMetrics(next.fold)}});}
}
async function dimensions(tx:Executor,task:IncrementalRuntimeTask,sequence:string){let after:string|undefined;
 for(;;){const rows=await tx.execute(sql`SELECT role,key,document FROM observability.runtime_task_current_rows WHERE task_id=${task.task.id} AND role IN('dimension-projects','dimension-agents','dimension-profiles','dimension-agent-tasks','dimension-profile-tasks') AND ${after?sql`role||':'||key>${after}`:sql`true`} ORDER BY role||':'||key LIMIT 200`);if(!rows.length)break;
  for(const r of rows){const d=r['document'] as {key:string;metadata:Record<string,unknown>;fold:IncrementalRuntimeTask['fold']};let fold=task.fold;if(r['role']!=='dimension-projects'){fold=emptyCompleteRuntimeFold(d.fold.visible);const grouped=String(r['role']).includes('profile'),key=JSON.parse(String(d.metadata['parent']??d.key)) as unknown[],profileId=String(grouped?key[0]:key[3]),revision=String(grouped?key[1]:key[4]),agent=grouped?null:String(key[2]),parts=await tx.execute(sql`SELECT document->'fold' AS fold FROM observability.runtime_task_current_rows WHERE task_id=${task.task.id} AND role='attempts' AND document#>>'{attempt,kind}'='agent' AND document#>>'{attempt,profileId}'=${profileId} AND document#>>'{attempt,profileRevision}'=${revision} AND ${agent?sql`coalesce(document#>>'{attempt,agentId}',document#>>'{attempt,executionId}',document#>>'{attempt,id}')=${agent}`:sql`true`}`);for(const p of parts)mergeCompleteRuntimeFold(fold,p['fold'] as IncrementalRuntimeTask['fold']);}
   await putRuntimeRow(tx,task.task.id,sequence,String(r['role']),String(r['key']),{...d,fold:{...d.fold,gaps:fold.gaps,observedExecutions:fold.observedExecutions}});
  }after=String(rows.at(-1)!['role'])+':'+String(rows.at(-1)!['key']);
 }
}
/** Source closure changes only proof/attempt quality; numerical rows and native stores are not reallocated. */
export async function patchRuntimeProofs(db:Database,work:{key:string;revision:string},signal:AbortSignal):Promise<boolean>{return db.transaction(async tx=>{
 signal.throwIfAborted();await admitRuntimeReport(tx);await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'observability.runtime-task/'+work.key},0))`);
 const [w]=await tx.execute(sql`SELECT revision::text,requires_full FROM observability.runtime_task_work WHERE key=${work.key} FOR UPDATE`);if(!w)return true;if(w['revision']!==work.revision)return true;if(w['requires_full']===true)return false;
 const [cached]=await tx.execute(sql`SELECT document FROM observability.runtime_task_cache WHERE task_id=${work.key}`);if(!cached)return false;const original=cached['document'] as IncrementalRuntimeTask;if(!original.rowThrough||original.fold.gaps.includes('coverage-incomplete'))return false;
 const [records]=await tx.execute(sql`SELECT EXISTS(SELECT 1 FROM observability.runtime_task_record_work WHERE task_id=${work.key}) AS value`);if(records?.['value']===true)return false;
 const rows=await tx.execute(sql`SELECT kind,key FROM observability.runtime_task_proof_work WHERE task_id=${work.key} ORDER BY kind,key LIMIT 200`);if(!rows.length)return false;await admitObservationWrite(tx,original.task.projectId);const sequence=await runtimeRowSequence(tx),affected=new Set<string>();
 for(const row of rows){let c:UsageNativeCapture|RuntimeNativePagedCapture|undefined;if(row['kind']==='native_captures'){const [stored]=await tx.execute(sql`SELECT summary FROM observability.native_captures WHERE id=${String(row['key'])}`);if(stored)c=UsageNativeCaptureSchema.parse(stored['summary']);}else c=await readNativeReportCapture(tx,String(row['key']));if(!c)throw Error('Original proof source disappeared');assertCompleteObserved(original.task,c.identity);const q=runtimeNativeQuality(c),key=jsonHash(q.captureIdentity),attemptKey=jsonHash(q.identity);if(!await readAttempt(tx,work.key,attemptKey))throw new ProofQualificationRequired('Original proof attempt needs qualification');
  await putRuntimeRow(tx,work.key,sequence,'capture-quality',key,{...q,attemptKey});await putRuntimeRow(tx,work.key,sequence,'sourceVersion' in c?'native-pages':'captures',key,c);
  const role='sourceVersion' in c?'native-pages':'captures',parent=attemptKey,[existing]=await tx.execute(sql`SELECT key,document FROM observability.runtime_task_current_rows WHERE task_id=${work.key} AND role='public-rows' AND document->>'section'=${role} AND document->>'key'=${c.id}`);await putRuntimeRow(tx,work.key,sequence,'public-rows',existing?String(existing['key']):'proof/'+key,{section:role,parent,key:c.id,document:c});
  if(!existing){const countKey=jsonHash(JSON.stringify([role,parent])),[count]=await tx.execute(sql`SELECT document FROM observability.runtime_task_current_rows WHERE task_id=${work.key} AND role='public-counts' AND key=${countKey}`);await putRuntimeRow(tx,work.key,sequence,'public-counts',countKey,{section:role,parent,total:String(BigInt((count?.['document'] as {total:string}|undefined)?.total??'0')+1n)});}
  affected.add(attemptKey);await tx.execute(sql`DELETE FROM observability.runtime_task_proof_work WHERE task_id=${work.key} AND kind=${String(row['kind'])} AND key=${String(row['key'])}`);
 }
 for(const key of affected)await qualifyRuntimeAttemptProof(tx,work.key,key,sequence);
 const next={...structuredClone(original),fold:emptyCompleteRuntimeFold(original.fold.visible),version:newResourceId(),rowThrough:sequence,capturedAt:new Date().toISOString()};let after:string|undefined;
 for(;;){const page=await tx.execute(sql`SELECT key,document->'fold' AS fold FROM observability.runtime_task_current_rows WHERE task_id=${work.key} AND role='attempts' AND ${after?sql`key>${after}`:sql`true`} ORDER BY key LIMIT 200`);if(!page.length)break;for(const p of page)mergeCompleteRuntimeFold(next.fold,p['fold'] as IncrementalRuntimeTask['fold']);after=String(page.at(-1)!['key']);}
 for(const gap of original.fold.gaps.filter(g=>!RUNTIME_NATIVE_GAPS.some(n=>n===g)))if(!next.fold.gaps.includes(gap))next.fold.gaps.push(gap);
 await dimensions(tx,next,sequence);await patchRuntimeQuality(tx,original,next,sequence);await applyRuntimeDailyDeltas(tx,runtimeDailyDeltas(original,next));await tx.execute(sql`UPDATE observability.runtime_task_cache SET version=${next.version},document=${JSON.stringify(next)}::jsonb WHERE task_id=${work.key}`);await publishRuntimeSourceQuality(tx,next,work.key);await publishRuntimeScope(tx,next.task.projectId);await tx.execute(sql`UPDATE observability.runtime_projection_head SET revision=revision+1,as_of=${next.capturedAt} WHERE singleton=true`);
 await tx.execute(sql`DELETE FROM observability.runtime_task_work WHERE key=${work.key} AND revision=${work.revision}::bigint AND NOT EXISTS(SELECT 1 FROM observability.runtime_task_proof_work WHERE task_id=${work.key})`);return true;
 }).catch(error=>{if(error instanceof ProofQualificationRequired)return false;throw error;});}
