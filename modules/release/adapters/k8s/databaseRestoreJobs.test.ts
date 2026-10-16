import {expect,test} from 'bun:test';
import {createFakeK8sClient,LABELS,Resources} from '@crewstation/k8s';
import type {K8sObject} from '@crewstation/k8s';
import {jsonHash} from '@crewstation/kernel';
import {kubernetesRestoreJobObserver} from './databaseRestoreJobs';
import {retainJobProof} from '../../domain/databaseRestore';
async function fixture(){
 const k8s=createFakeK8sClient(),image='registry/app@sha256:'+'a'.repeat(64),jobId=Bun.randomUUIDv7(),name='restore-job',namespace='cs-restore-test';
 const environment={CS_DATABASE_URL:'postgres://target',CS_OBJECTS_TOKEN:'must-not-escape'},target={serverId:'server-identity',databaseOid:'10',roleOid:'20'};
 const labels={[LABELS.release]:jobId,[LABELS.component]:'database-verify'},container={name:'main',image,command:['app','verify'],env:[],envFrom:[{secretRef:{name:name+'-env'}}]};
 const job=await k8s.create<K8sObject>({apiVersion:'batch/v1',kind:'Job',metadata:{namespace,name,labels},spec:{template:{spec:{containers:[container]}}}});
 await k8s.create<K8sObject>({apiVersion:'v1',kind:'Secret',metadata:{namespace,name:name+'-env'},immutable:true,data:Object.fromEntries(Object.entries(environment).map(([key,value])=>[key,Buffer.from(value).toString('base64')]))});
 const pod=await k8s.create<K8sObject>({apiVersion:'v1',kind:'Pod',metadata:{namespace,name:'restore-pod',labels:{'job-name':name},ownerReferences:[{apiVersion:'batch/v1',kind:'Job',name,uid:job.metadata.uid!}]},spec:{containers:[container]},status:{containerStatuses:[{name:'main',imageID:'containerd://sha256:'+'a'.repeat(64),state:{terminated:{exitCode:0}}}]}});
 let output='CS_DATABASE_RESTORE_RECEIPT='+JSON.stringify({version:1,backupReferenceDigest:'b'.repeat(64),schemaDigest:'sha256:'+'c'.repeat(64),complete:true,autoResumeSuspended:true})+'\n';
 k8s.logs=async()=>new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(output));controller.close();}});
 const observer=kubernetesRestoreJobObserver(k8s),input={namespace,name,jobId,purpose:'database-verify' as const,image,command:['app','verify'],target,environment,previous:null};
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
test('a Job success label does not substitute for exited bytes, unique Pod, receipt or actual image digest',async()=>{
 const f=await fixture();await f.complete();f.output('CS_DATABASE_RESTORE_RECEIPT={}\n');await expect(f.observer.observe(f.input)).rejects.toThrow('合同');
 f.output('no receipt');await expect(f.observer.observe(f.input)).rejects.toThrow('唯一');
 await f.k8s.mergePatch(Resources.Pod!,'restore-pod',f.input.namespace,{status:{containerStatuses:[{imageID:'containerd://sha256:'+'d'.repeat(64),state:{terminated:{exitCode:0}}}]}});
 await expect(f.observer.observe(f.input)).rejects.toThrow('镜像摘要');
 await f.k8s.create<K8sObject>({...f.pod,metadata:{...f.pod.metadata,name:'second-pod',uid:'second-pod'}});await expect(f.observer.observe(f.input)).rejects.toThrow('多个执行 Pod');
});
test('unknown or failed-without-Pod results cannot create a fresh attempt; template and secret drift fail closed',async()=>{
 const f=await fixture();const observed=(await f.observer.observe(f.input))!;await f.k8s.delete(Resources.Pod!,'restore-pod',f.input.namespace);
 await f.k8s.mergePatch(Resources.Job!,f.input.name,f.input.namespace,{status:{conditions:[{type:'Failed',status:'True'}]}});await expect(f.observer.observe(f.input)).rejects.toThrow('终止证明');
 await f.k8s.delete(Resources.Job!,f.input.name,f.input.namespace);await expect(f.observer.observe({...f.input,previous:observed})).rejects.toThrow('不能按同名重建');
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
