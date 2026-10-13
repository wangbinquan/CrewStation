import {expect,test} from 'bun:test';
import {noopLogger} from '@crewstation/kernel';
import {incrementalRuntimeTasks} from './incrementalRuntimeTasks';
import type {IncrementalRuntimeTaskSource} from '../ports/incrementalRuntimeTasks';

test('explicit drain starts pending projection work and every scheduling packet reaches the complete population',async()=>{
 let bootstrapped=false,inventories=0;
 const pending=Array.from({length:211},(_,n)=>({key:'task-'+n,revision:'1'})),seen:string[]=[];
 const source:IncrementalRuntimeTaskSource={inventory:async()=>{inventories++;},bootstrapDone:async()=>bootstrapped,finishBootstrap:async()=>{bootstrapped=true;},pending:async()=>pending.shift(),qualify:async work=>{seen.push(work.key);},acknowledge:async()=>{},stop:()=>{}};
 const worker=incrementalRuntimeTasks(source,noopLogger);
 try{await worker.drain();expect(pending).toHaveLength(0);expect(inventories).toBe(1);expect(seen).toEqual(Array.from({length:211},(_,n)=>'task-'+n));}finally{await worker.stop();}
});

test('a stopped projection owner resumes its source before qualifying new durable work',async()=>{
 let stopped=false,resumes=0,work:{key:string;revision:string}|undefined={key:'first',revision:'1'};
 const seen:string[]=[];
 const source:IncrementalRuntimeTaskSource={inventory:async()=>{},bootstrapDone:async()=>true,finishBootstrap:async()=>{},pending:async()=>{const next=work;work=undefined;return next;},qualify:async item=>{expect(stopped).toBe(false);seen.push(item.key);},acknowledge:async()=>{},resume:()=>{stopped=false;resumes++;},stop:()=>{stopped=true;}};
 const worker=incrementalRuntimeTasks(source,noopLogger);
 worker.start();worker.start();await worker.drain();await worker.stop();
 work={key:'second',revision:'2'};await worker.drain();expect(seen).toEqual(['first']);
 worker.start();worker.start();await worker.drain();await worker.stop();
 expect(seen).toEqual(['first','second']);expect(resumes).toBe(2);
});

// Quiescing a deletion must preserve whether the background owner was active.
test('resuming schedules the ordinary next round and explicit drain still runs all durable work',async()=>{
 let count=0,resumes=0;const source:IncrementalRuntimeTaskSource={inventory:async()=>{},bootstrapDone:async()=>true,finishBootstrap:async()=>{},pending:async()=>count++===0?{key:'original',revision:'1'}:undefined,qualify:async()=>{},acknowledge:async()=>{},resume:()=>{resumes++;},stop:()=>{}};
 const worker=incrementalRuntimeTasks(source,noopLogger);expect(worker.isStarted()).toBe(false);
 worker.resume();expect(worker.isStarted()).toBe(true);expect(count).toBe(0);await worker.drain();expect(count).toBe(2);await worker.stop();expect(worker.isStarted()).toBe(false);expect(resumes).toBe(1);
});

test('temporary quiescence preserves a cold owner and the next explicit drain can reopen its source',async()=>{
 let stopped=false,pending=true,seen=0;const source:IncrementalRuntimeTaskSource={inventory:async()=>{},bootstrapDone:async()=>true,finishBootstrap:async()=>{},pending:async()=>pending?{key:'retained',revision:'1'}:undefined,qualify:async()=>{expect(stopped).toBe(false);pending=false;seen++;},acknowledge:async()=>{},resume:()=>{stopped=false;},stop:()=>{stopped=true;}};
 const worker=incrementalRuntimeTasks(source,noopLogger);await worker.stop();worker.resume(false);expect(worker.isStarted()).toBe(false);expect(seen).toBe(0);await worker.drain();expect(seen).toBe(1);await worker.stop();
});

test('bootstrap failure retains the original durable source and publishes an error before fair recovery',async()=>{
 let broken=true,done=false,failure:string|undefined,seen=0;const pending=[{key:'original-source',revision:'1'}];
 const source:IncrementalRuntimeTaskSource={inventory:async()=>{if(broken)throw Error('Original Task source unavailable');},bootstrapDone:async()=>done,finishBootstrap:async()=>{done=true;failure=undefined;},pending:async()=>pending.shift(),qualify:async()=>{seen++;},acknowledge:async()=>{},failed:async error=>{failure=String(error);},stop:()=>{}};
 const worker=incrementalRuntimeTasks(source,noopLogger);try{await worker.drain();expect(failure).toContain('Original Task source unavailable');expect(done).toBe(false);expect(pending).toHaveLength(1);expect(seen).toBe(0);broken=false;await worker.drain();expect(done).toBe(true);expect(failure).toBeUndefined();expect(pending).toHaveLength(0);expect(seen).toBe(1);}finally{await worker.stop();}
});
