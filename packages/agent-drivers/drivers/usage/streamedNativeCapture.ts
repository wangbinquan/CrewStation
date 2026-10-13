import {Database} from 'bun:sqlite';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {jsonHash} from '@crewstation/kernel';
import {RunnerUsageCaptureSchema,NativeUsageOrderSchema,type NativeUsageStep,type NativeUsageProof,type RunnerUsageMeasurement} from '@crewstation/contracts';
import type {NativeCaptureInput,NativeUsageCapture} from './nativeCapture';
import {openNativeUsagePass} from './nativeUsagePass';
import type {NativeUsagePassReader,NativeUsagePassStep} from './nativeUsagePassTypes';
class NativeStoreUnavailable extends Error {}
/** The legacy wire format is emitted in bounded packets from disk-backed original passes, without population cutoffs. */
export function createStreamedNativeCapture(input:NativeCaptureInput,path:string|null):NativeUsageCapture{
 const directory=mkdtempSync(join(tmpdir(),'cs-original-native-turn-')),db=new Database(join(directory,'rows.sqlite'));
 db.exec("PRAGMA cache_size=-8192;CREATE TABLE sessions(phase TEXT,id TEXT,parent TEXT,PRIMARY KEY(phase,id));CREATE TABLE steps(phase TEXT,id TEXT,session TEXT,document TEXT,PRIMARY KEY(phase,id));CREATE INDEX steps_session ON steps(phase,session,id)");
 let began=false,disposed=false,atBegin=0,root:string|undefined,baseline:{fingerprint:string;steps:number;order:{epoch:string;sequence:number}}|undefined;
 const issues=new Set<string>();
 function dispose(){if(disposed)return;disposed=true;db.close();rmSync(directory,{recursive:true,force:true});}
 function orderedPass(rootId:string,phase:'baseline'|'final'){
  if(!path||path===':memory:'||!existsSync(path))throw new NativeStoreUnavailable('Original native database unavailable');const orderDb=new Database(path+'.crewstation-usage.sqlite');let pass:NativeUsagePassReader|undefined;
  try{orderDb.exec('PRAGMA busy_timeout=0;BEGIN IMMEDIATE;CREATE TABLE IF NOT EXISTS snapshot_order(id INTEGER PRIMARY KEY CHECK(id=1),epoch TEXT NOT NULL,sequence INTEGER NOT NULL)');orderDb.query('INSERT OR IGNORE INTO snapshot_order VALUES(1,?,0)').run(randomUUID());const value=orderDb.query<{epoch:string;sequence:number},[]>('SELECT epoch,sequence FROM snapshot_order WHERE id=1').get()!;
   const order=NativeUsageOrderSchema.parse({epoch:value.epoch,sequence:value.sequence+1});pass=openNativeUsagePass(path,{passId:randomUUID(),turn:input.turn,nativeSource:jsonHash(path),sourceGeneration:order.epoch,rootSessionId:rootId,lineageKey:input.lineageKey,epoch:order.epoch,phase});
   if(pass.rootParentSessionId!==null)throw Error('Original native root has a parent');
   let cursor=pass.initialCursor,fingerprint:string|undefined,steps=0,sessions=0;
   for(;;){const page=pass.next(cursor);db.exec('BEGIN');try{for(const s of page.sessions)db.query('INSERT INTO sessions VALUES(?,?,?)').run(phase,s.id,s.parentSessionId);for(const s of page.steps)db.query('INSERT INTO steps VALUES(?,?,?,?)').run(phase,s.stepId,s.id,JSON.stringify(s));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}for(const issue of page.issues)issues.add(issue);if(page.eof){fingerprint=page.eof.fingerprint;steps=Number(page.eof.counts.steps);sessions=Number(page.eof.counts.sessions);if(!Number.isSafeInteger(steps)||!Number.isSafeInteger(sessions))throw Error('Legacy numeric count representation unavailable');}pass.acknowledge(page.ordinal,page.payloadDigest);if(page.nextCursor===null)break;cursor=page.nextCursor;}
   if(!fingerprint)throw Error('Original source EOF missing');orderDb.query('UPDATE snapshot_order SET sequence=? WHERE id=1').run(order.sequence);orderDb.exec('COMMIT');return {fingerprint,steps,sessions,order,rootCreatedAt:pass.rootCreatedAt};
  }catch(e){try{orderDb.exec('ROLLBACK');}catch{}throw e;}finally{pass?.close();orderDb.close();}
 }
 function step(raw:NativeUsagePassStep,phase:'baseline'|'final'):NativeUsageStep{const ancestors:string[]=[];let parent=raw.parentSessionId;const seen=new Set([raw.id]);while(parent!==null){if(seen.has(parent))throw Error('Original native parent cycle');seen.add(parent);ancestors.push(parent);const row=db.query<{parent:string|null},[string,string]>('SELECT parent FROM sessions WHERE phase=? AND id=?').get(phase,parent);if(!row)throw Error('Original native parent unavailable');parent=row.parent;}ancestors.reverse();return {id:raw.stepId,sessionId:raw.id,parentSessionId:raw.parentSessionId,ancestors,occurredAt:raw.occurredAt===null?null:new Date(raw.occurredAt).toISOString(),usage:raw.usage,actualModel:raw.model?{provider:raw.model.provider,model:raw.model.id,condition:null}:null};}
 function proof(at:number,patch:Partial<NativeUsageProof>):NativeUsageProof{return {contract:'opencode-child-steps-v1',lineageKey:input.lineageKey,turn:input.turn,turnIndex:input.turnIndex,state:'pending',root:input.resumeSessionId??null,observedAt:new Date(at).toISOString(),baseline:{kind:input.resumeSessionId?'resume':'fresh',fingerprint:baseline?.fingerprint??null,...(baseline?{order:baseline.order}:{})},fingerprint:null,sessions:0,steps:0,emitted:0,baselineSteps:baseline?.steps??0,priorRevisionGap:false,issues:[],...patch};}
 function measurement(original:NativeUsageStep,root:string,at:number):RunnerUsageMeasurement{return {recordId:'opencode:step:'+jsonHash({session:original.sessionId,id:original.id}),revision:input.nextRevision(),observedAt:new Date(at).toISOString(),occurredAt:original.occurredAt,actualModel:original.actualModel,adapterVersion:'opencode-native-stream/cs@3',reporting:'delta',inclusion:'self',scope:{root,session:original.sessionId,parentSession:original.parentSessionId,ancestors:original.ancestors,turn:input.turn,turnIndex:input.turnIndex,level:'request'},coverage:Object.values(original.usage).every(v=>v!==null)?'complete':'partial',validity:'valid',coveredThroughTurn:null,usage:original.usage,basis:{kind:'invocation'}};}
 return {
  async begin(at){if(began)throw Error('Original turn already begun');began=true;atBegin=at;if(input.resumeSessionId){try{baseline=orderedPass(input.resumeSessionId,'baseline');}catch{issues.add('native-baseline-unavailable');}}return RunnerUsageCaptureSchema.parse({version:1,measurements:[],diagnostics:[],nativeProof:proof(at,{})});},
  includesRecord(_session,id){return !input.resumeSessionId||!!baseline&&!db.query('SELECT id FROM steps WHERE phase=\'baseline\' AND id=?').get(id);},
  observeSession(id){if(root&&root!==id)issues.add('native-root-changed');root??=id;},
  async *finish(observedRoot,at,extra=[]){let final:ReturnType<typeof orderedPass>|undefined,emitted=0,priorRevisionGap=false;const actual=observedRoot??input.resumeSessionId;for(const i of extra)issues.add(i);
   try{if(!began)issues.add('native-baseline-not-started');if(!actual||(root&&root!==actual)||(input.resumeSessionId&&input.resumeSessionId!==actual))issues.add('native-root-changed');if(actual){try{final=orderedPass(actual,'final');}catch(error){if(error instanceof NativeStoreUnavailable){issues.add('native-store-unavailable');issues.add('native-order-unavailable');}else issues.add('native-read-failed');}}
    if(!input.resumeSessionId&&final?.rootCreatedAt===null)issues.add('native-root-birth-unavailable');
    if(!input.resumeSessionId&&final?.rootCreatedAt!==null&&final?.rootCreatedAt!==undefined&&final.rootCreatedAt<atBegin)issues.add('native-preexisting-root-unowned');
    if(input.resumeSessionId&&!baseline)issues.add('native-baseline-unavailable');
    const attributable=began&&actual&&final&&!issues.has('native-root-changed')&&!issues.has('native-preexisting-root-unowned')&&!issues.has('native-root-birth-unavailable')&&(!input.resumeSessionId||baseline);
    if(attributable){let after:string|undefined;for(;;){const rows=db.query<{id:string;document:string},[string]>('SELECT id,document FROM steps f WHERE phase=\'final\' AND id>? AND NOT EXISTS(SELECT 1 FROM steps b WHERE b.phase=\'baseline\' AND b.id=f.id) ORDER BY id LIMIT 100').all(after??'');if(!rows.length)break;for(const row of rows){const m=measurement(step(JSON.parse(row.document),'final'),actual,at);yield RunnerUsageCaptureSchema.parse({version:1,measurements:[m],diagnostics:[]});emitted++;}after=rows.at(-1)!.id;await Promise.resolve();}
     after=undefined;let offset=0;for(;;){const rows=db.query<{id:string;before:string;after:string|null},[string]>('SELECT b.id,b.document AS before,f.document AS after FROM steps b LEFT JOIN steps f ON f.phase=\'final\' AND f.id=b.id WHERE b.phase=\'baseline\' AND b.id>? ORDER BY b.id LIMIT 100').all(after??'');if(!rows.length)break;for(const row of rows){const before=step(JSON.parse(row.before),'baseline'),next=row.after?step(JSON.parse(row.after),'final'):null;if(!next||jsonHash(before)!==jsonHash(next))priorRevisionGap=true;yield RunnerUsageCaptureSchema.parse({version:1,measurements:[],diagnostics:[],nativeBaseline:{lineageKey:input.lineageKey,turn:input.turn,root:input.resumeSessionId??actual,offset:offset++,steps:[{before,after:next,afterObserved:!!final}]}});}after=rows.at(-1)!.id;await Promise.resolve();}
    }
    if(priorRevisionGap)issues.add('native-prior-revision-gap');if(!final)issues.add('native-root-unavailable');
    yield RunnerUsageCaptureSchema.parse({version:1,measurements:[],diagnostics:[],nativeProof:proof(at,{state:final&&!issues.size?'complete':'partial',root:actual??null,fingerprint:final?.fingerprint??null,sessions:final?.sessions??0,steps:final?.steps??0,emitted,priorRevisionGap,issues:[...issues],...(final?{order:final.order}:{})})});
   }finally{dispose();}
  }
 };
}
