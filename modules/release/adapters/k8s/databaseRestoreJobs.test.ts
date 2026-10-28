import {expect,test} from 'bun:test';
import {createFakeK8sClient,LABELS,Resources} from '@crewstation/k8s';
import type {K8sObject} from '@crewstation/k8s';
import {jsonHash} from '@crewstation/kernel';
import {kubernetesRestoreJobObserver} from './databaseRestoreJobs';
import {retainJobProof} from '../../domain/databaseRestore';
import type { RestoreJobObserver } from '../../ports/databaseRestore';
import { migrationCanonical, migrationDigest } from '../../domain/database-migration/evidence';
async function fixture(purpose:Parameters<RestoreJobObserver['observe']>[0]['purpose']='database-verify'){
 const k8s=createFakeK8sClient(),image='registry/app@sha256:'+'a'.repeat(64),jobId=Bun.randomUUIDv7(),name='restore-job',namespace='cs-restore-test';
 const environment={CS_DATABASE_URL:'postgres://target',CS_OBJECTS_TOKEN:'must-not-escape'},target={serverId:'server-identity',databaseOid:'10',roleOid:'20'};
 const labels={[LABELS.release]:jobId,[LABELS.component]:purpose},container={name:'main',image,command:['app','verify'],env:[],envFrom:[{secretRef:{name:name+'-env'}}]};
 const job=await k8s.create<K8sObject>({apiVersion:'batch/v1',kind:'Job',metadata:{namespace,name,labels},spec:{template:{spec:{containers:[container]}}}});
 await k8s.create<K8sObject>({apiVersion:'v1',kind:'Secret',metadata:{namespace,name:name+'-env'},immutable:true,data:Object.fromEntries(Object.entries(environment).map(([key,value])=>[key,Buffer.from(value).toString('base64')]))});
 const pod=await k8s.create<K8sObject>({apiVersion:'v1',kind:'Pod',metadata:{namespace,name:'restore-pod',labels:{'job-name':name},ownerReferences:[{apiVersion:'batch/v1',kind:'Job',name,uid:job.metadata.uid!}]},spec:{containers:[container]},status:{containerStatuses:[{name:'main',imageID:'containerd://sha256:'+'a'.repeat(64),state:{terminated:{exitCode:0}}}]}});
 let output='CS_DATABASE_RESTORE_RECEIPT='+JSON.stringify({version:1,backupReferenceDigest:'b'.repeat(64),schemaDigest:'sha256:'+'c'.repeat(64),complete:true,autoResumeSuspended:true})+'\n';
 k8s.logs=async()=>new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(output));controller.close();}});
 const observer=kubernetesRestoreJobObserver(k8s),input={namespace,name,jobId,purpose,image,command:['app','verify'],target,environment,previous:null};
 const complete=()=>k8s.mergePatch(Resources.Job!,name,namespace,{status:{conditions:[{type:'Complete',status:'True'}]}});
 return {k8s,observer,input,container,job,pod,complete,output:(value:string)=>{output=value;}};
}
test('restore proof requires original immutable environment, Pod exit, image and one valid verification receipt',async()=>{
 const f=await fixture();await f.complete();const proof=(await f.observer.observe(f.input))!;
 expect(proof).toMatchObject({receipt:{state:'succeeded',exitCode:0,target:f.input.target},podUid:f.pod.metadata.uid,environmentDigest:jsonHash(f.input.environment),verification:{complete:true,autoResumeSuspended:true}});
 expect(JSON.stringify(proof)).not.toContain('must-not-escape');
 await f.k8s.delete(Resources.Job!,f.input.name,f.input.namespace);expect(await f.observer.observe({...f.input,previous:proof})).toEqual(proof);
 expect(()=>retainJobProof(proof,{...proof,podUid:'replacement'})).toThrow('身份已变化');
});
// RFC-042 review: a missing or invalid verify receipt, a Job past activeDeadlineSeconds (Pod removed)
// and a Job removed by its TTL used to throw on every observation, so the operation could never retry.
test('a Job success label does not substitute for exited bytes; a missing or invalid receipt is a named failed attempt', async () => {
 const f=await fixture();await f.complete();f.output('CS_DATABASE_RESTORE_RECEIPT={}\n');
 expect(await f.observer.observe(f.input)).toMatchObject({receipt:{state:'failed',exitCode:0,failure:'receipt-invalid'},podUid:f.pod.metadata.uid});
 f.output('no receipt');const missing=(await f.observer.observe(f.input))!;expect(missing.receipt).toMatchObject({state:'failed',failure:'receipt-invalid'});expect(missing).not.toHaveProperty('verification');
 expect(await f.observer.observe({...f.input,previous:missing})).toEqual(missing);
 await f.k8s.mergePatch(Resources.Pod!,'restore-pod',f.input.namespace,{status:{containerStatuses:[{imageID:'containerd://sha256:'+'d'.repeat(64),state:{terminated:{exitCode:0}}}]}});
 await expect(f.observer.observe(f.input)).rejects.toThrow('镜像摘要');
 await f.k8s.create<K8sObject>({...f.pod,metadata:{...f.pod.metadata,name:'second-pod',uid:'second-pod'}});await expect(f.observer.observe(f.input)).rejects.toThrow('多个执行 Pod');
});
test('deadline, missing Pod and TTL loss end the attempt as retryable failures; a still-running Pod is waited for', async () => {
 const f=await fixture(),running=(await f.observer.observe(f.input))!;
 await f.k8s.mergePatch(Resources.Pod!,'restore-pod',f.input.namespace,{status:{phase:'Running',containerStatuses:[{name:'main',imageID:'containerd://sha256:'+'a'.repeat(64),state:{running:{}}}]}});
 await f.k8s.mergePatch(Resources.Job!,f.input.name,f.input.namespace,{status:{conditions:[{type:'Failed',status:'True',reason:'DeadlineExceeded'}]}});
 await expect(f.observer.observe({...f.input,previous:running})).rejects.toMatchObject({kind:'unavailable',details:{code:'restore_job_terminating'}});
 await f.k8s.delete(Resources.Pod!,'restore-pod',f.input.namespace);
 const deadline=(await f.observer.observe({...f.input,previous:running}))!;
 expect(deadline.receipt).toMatchObject({state:'failed',exitCode:null,failure:'deadline-exceeded'});expect(deadline.podUid).toBe(running.podUid);
 const g=await fixture();await g.k8s.delete(Resources.Pod!,'restore-pod',g.input.namespace);await g.k8s.mergePatch(Resources.Job!,g.input.name,g.input.namespace,{status:{conditions:[{type:'Failed',status:'True',reason:'BackoffLimitExceeded'}]}});
 expect((await g.observer.observe(g.input))!.receipt.failure).toBe('pod-missing');
 const h=await fixture(),observed=(await h.observer.observe(h.input))!;await h.k8s.delete(Resources.Job!,h.input.name,h.input.namespace);
 await h.k8s.mergePatch(Resources.Pod!,'restore-pod',h.input.namespace,{status:{phase:'Running'}});
 await expect(h.observer.observe({...h.input,previous:observed})).rejects.toMatchObject({details:{code:'restore_job_terminating'}});
 await h.k8s.delete(Resources.Pod!,'restore-pod',h.input.namespace);
 expect((await h.observer.observe({...h.input,previous:observed}))!.receipt).toMatchObject({state:'failed',failure:'job-lost',uid:observed.receipt.uid});
 expect(await h.observer.observe(h.input)).toBeNull();
});
test('template and secret drift still fail closed instead of opening an attempt', async () => {
 const g=await fixture();await g.k8s.mergePatch(Resources.Job!,g.input.name,g.input.namespace,{spec:{template:{spec:{containers:[{...g.container,args:['--database=other']}]}}}});await expect(g.observer.observe(g.input)).rejects.toThrow('命令');
 const h=await fixture();await h.k8s.mergePatch(Resources.Secret!,h.input.name+'-env',h.input.namespace,{data:{CS_DATABASE_URL:Buffer.from('postgres://different').toString('base64')}});await expect(h.observer.observe(h.input)).rejects.toThrow('原输入');
});
test('candidate acceptance observes real owner-bound ready Pods and image, not only Deployment counters',async()=>{
 const f=await fixture(),name='app-green',namespace=f.input.namespace,releaseId=Bun.randomUUIDv7(),secretName=name+'-env-1';
 const container={...f.container,envFrom:[{secretRef:{name:secretName}}]};
 const deployment=await f.k8s.create<K8sObject>({apiVersion:'apps/v1',kind:'Deployment',metadata:{name,namespace,generation:1},spec:{replicas:1,template:{metadata:{labels:{[LABELS.release]:releaseId}},spec:{containers:[container]}}},status:{observedGeneration:1,readyReplicas:1,updatedReplicas:1}});
 await f.k8s.create<K8sObject>({apiVersion:'v1',kind:'Secret',metadata:{name:secretName,namespace},immutable:true,data:Object.fromEntries(Object.entries(f.input.environment).map(([key,value])=>[key,Buffer.from(value).toString('base64')]))});
 const input={namespace,serviceName:'app',physical:'green' as const,releaseId,revision:1,image:f.input.image,environment:f.input.environment};expect(await f.observer.candidate(input)).toBeNull();
 const set=await f.k8s.create<K8sObject>({apiVersion:'apps/v1',kind:'ReplicaSet',metadata:{name:'set',namespace,ownerReferences:[{apiVersion:'apps/v1',kind:'Deployment',uid:deployment.metadata.uid!,name}]}});
 const pod:K8sObject={apiVersion:'v1',kind:'Pod',metadata:{name:'candidate',namespace,labels:{[LABELS.release]:releaseId},ownerReferences:[{apiVersion:'apps/v1',kind:'ReplicaSet',uid:set.metadata.uid!,name:'set'}]},spec:{containers:[container]},status:{conditions:[{type:'Ready',status:'True'}],containerStatuses:[{ready:true,imageID:f.input.image}]}};
 await f.k8s.create(pod);expect(await f.observer.candidate(input)).toMatchObject({deploymentUid:deployment.metadata.uid,environmentDigest:jsonHash(input.environment)});
 await f.k8s.mergePatch(Resources.Pod!,'candidate',namespace,{status:{containerStatuses:[{ready:true,imageID:'sha256:'+'e'.repeat(64)}]}});await expect(f.observer.candidate(input)).rejects.toThrow('镜像摘要');
});

for(const purpose of ['database-migration-plan','database-migration-run','database-migration-verify','database-migration-rollback','database-migration-complete'] as const)test(`RFC-044 ${purpose} consumes full stdout and retains the original Secret and image proof`,async()=>{
 const f=await fixture(purpose);await f.complete();const payload={operationId:'dbm_e2_12345678',kind:'verified'},receipt={payload,digest:migrationDigest(payload)};
 const plan={operationId:payload.operationId,plan:{payload:{source:{},target:{generationId:'dbg_'+ 'a'.repeat(32),location:{}},blocks:[]},digest:'sha256:'+'a'.repeat(64),approvalDigest:'sha256:'+'b'.repeat(64)},jsonPath:null,markdownPath:null,acknowledgeable:[],requiresApproval:true,guidance:[]};
 const output=purpose==='database-migration-plan'?'CS_DATABASE_MIGRATION_PLAN='+JSON.stringify(plan)+'\n':'CS_DATABASE_MIGRATION_RECEIPT='+migrationCanonical(receipt);
 f.output(output+'later log\n'.repeat(200));const proof=await f.observer.observe(f.input);expect(proof?.receipt.state).toBe('succeeded');expect(proof?.output?.kind).toBe(purpose==='database-migration-plan'?'plan':'receipt');expect(proof?.logTail).toContain('later log');expect(proof?.secretUid).toBeTruthy();expect(proof?.environmentDigest).toBe(jsonHash(f.input.environment));
 for(const invalid of ['no marker',output+output,'x'.repeat(16*1024*1024+1)]){f.output(invalid);expect((await f.observer.observe(f.input))?.receipt).toMatchObject({state:'failed',failure:'receipt-invalid'});}
});
