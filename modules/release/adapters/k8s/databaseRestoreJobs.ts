import type { K8sClient, K8sObject } from '@crewstation/k8s';
import { LABELS, Resources } from '@crewstation/k8s';
import { DatabaseRestoreVerificationSchema } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { RestoreJobObserver } from '../../ports/databaseRestore';
import type { RestoreJobProof } from '../../domain/databaseRestore';
import { retainJobProof } from '../../domain/databaseRestore';
const record = (x: unknown): Record<string,unknown> => x && typeof x==='object'&&!Array.isArray(x)? x as Record<string,unknown>:{};
const array = (x: unknown): Record<string,unknown>[] => Array.isArray(x)?x.map(record):[];
function containerOf(object: K8sObject, job: boolean) {
  const spec=job?record(record(record(object.spec).template).spec):record(object.spec);
  const containers=array(spec.containers);
  if(containers.length!==1||array(spec.initContainers).length||array(spec.ephemeralContainers).length)throw conflict('恢复工作负载容器形状变化');
  return containers[0]!;
}
function exactContainer(container: Record<string,unknown>, input: Parameters<RestoreJobObserver['observe']>[0]) {
  if(container.image!==input.image||jsonHash(container.command)!==jsonHash(input.command)||(Array.isArray(container.args)&&container.args.length>0)||array(container.env).length||array(container.envFrom).length!==1
    ||record(array(container.envFrom)[0]!.secretRef).name!==input.name+'-env')throw conflict('恢复 Job 镜像、命令或原凭据来源变化');
}
async function receiptLog(k8s: K8sClient, namespace:string,pod:string,container:string) {
  const reader=(await k8s.logs(namespace,pod,{container,follow:false,tailLines:64,signal:AbortSignal.timeout(15_000)})).getReader();
  let total=0,text=''; const decoder=new TextDecoder();
  try {for(;;){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>65536)throw precondition('恢复校验输出超过回执上限');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}
  finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
  const lines=text.split(/\r?\n/).filter(line=>line.startsWith('CS_DATABASE_RESTORE_RECEIPT='));
  if(lines.length!==1)throw precondition('恢复校验缺少唯一的版本化回执');
  try{return DatabaseRestoreVerificationSchema.parse(JSON.parse(lines[0]!.slice('CS_DATABASE_RESTORE_RECEIPT='.length)));}catch{throw precondition('恢复校验回执不符合合同');}
}
export function kubernetesRestoreJobObserver(k8s: K8sClient):RestoreJobObserver {
  return {candidate: async input => {
    const name=input.serviceName+'-'+input.physical, deployment=await k8s.get(Resources.Deployment!,name,input.namespace);
    if(!deployment?.metadata.uid||deployment.metadata.deletionTimestamp)return null;
    const status=record(deployment.status),spec=record(deployment.spec),podSpec=record(record(spec.template).spec);
    const containers=array(podSpec.containers),container=containers[0],secretName=name+'-env-'+input.revision;
    if(containers.length!==1||array(podSpec.initContainers).length||array(podSpec.ephemeralContainers).length||container?.image!==input.image||array(container?.envFrom).length!==1||record(array(container?.envFrom)[0]?.secretRef).name!==secretName||array(container?.env).length)throw conflict('恢复候选部署的镜像或数据库凭据来源变化');
    const labels=record(record(spec.template).metadata).labels as Record<string,string>|undefined;
    if(labels?.[LABELS.release]!==input.releaseId)throw conflict('恢复候选部署已被其他发布替换');
    if(Number(status.observedGeneration)<Number(deployment.metadata.generation)||Number(status.readyReplicas)!==Number(spec.replicas)||Number(status.updatedReplicas)!==Number(spec.replicas)||Number(spec.replicas)<1)return null;
    const secret=await k8s.get(Resources.Secret!,secretName,input.namespace);if(!secret?.metadata.uid||secret.metadata.deletionTimestamp||secret.immutable!==true)return null;
    const env=Object.fromEntries(Object.entries(record(secret.data)).map(([key,value])=>[key,Buffer.from(String(value),'base64').toString()]));
    if(jsonHash(env)!==jsonHash(input.environment))throw conflict('恢复候选实际凭据不属于原目标数据库');
    const sets=(await k8s.list(Resources.ReplicaSet!,input.namespace)).filter(set=>set.metadata.ownerReferences?.some(owner=>owner.uid===deployment.metadata.uid&&owner.kind==='Deployment'));
    const owners=new Set(sets.map(set=>set.metadata.uid));
    const pods=(await k8s.list(Resources.Pod!,input.namespace,{labelSelector:LABELS.release+'='+input.releaseId})).filter(pod=>!pod.metadata.deletionTimestamp&&pod.metadata.ownerReferences?.some(owner=>owner.kind==='ReplicaSet'&&owners.has(owner.uid)));
    if(pods.length!==Number(spec.replicas))return null;
    for(const pod of pods){
      const actual=containerOf(pod,false),state=record(pod.status),runtime=array(state.containerStatuses);
      if(actual.image!==input.image||array(actual.env).length||array(actual.envFrom).length!==1||record(array(actual.envFrom)[0]?.secretRef).name!==secretName)throw conflict('恢复候选实际 Pod 的目标环境变化');
      if(!pod.metadata.uid||runtime.length!==1||runtime[0]!.ready!==true||!array(state.conditions).some(condition=>condition.type==='Ready'&&condition.status==='True'))return null;
      if(String(runtime[0]!.imageID).match(/sha256:[a-f0-9]{64}$/)?.[0]!==input.image.split('@')[1])throw conflict('恢复候选实际镜像摘要变化');
    }
    const latest=await k8s.get(Resources.Deployment!,name,input.namespace);
    if(latest?.metadata.uid!==deployment.metadata.uid||latest.metadata.generation!==deployment.metadata.generation)throw conflict('观察期间恢复候选部署变化');
    return {deploymentUid:deployment.metadata.uid,secretUid:secret.metadata.uid,environmentDigest:jsonHash(env)};
  },observe:async input=>{
    if(input.previous&&['succeeded','failed'].includes(input.previous.receipt.state))return input.previous;
    const job=await k8s.get(Resources.Job!,input.name,input.namespace);
    if(!job){if(input.previous)throw conflict('原恢复 Job 已丢失，不能按同名重建');return null;}
    if(!job.metadata.uid||job.metadata.deletionTimestamp||job.metadata.labels?.[LABELS.release]!==input.jobId||job.metadata.labels?.[LABELS.component]!==input.purpose)throw conflict('恢复 Job 原身份不匹配');
    exactContainer(containerOf(job,true),input);
    const secret=await k8s.get(Resources.Secret!,input.name+'-env',input.namespace);
    if(!secret?.metadata.uid||secret.metadata.deletionTimestamp||secret.immutable!==true)throw precondition('恢复 Job 原凭据尚不可确认');
    const encoded=record(secret.data), actual=Object.fromEntries(Object.entries(encoded).map(([key,value])=>[key,Buffer.from(String(value),'base64').toString()]));
    if(jsonHash(actual)!==jsonHash(input.environment))throw conflict('恢复 Job 目标环境与原输入不一致');
    const pods=(await k8s.list(Resources.Pod!,input.namespace,{labelSelector:'job-name='+input.name})).filter(p=>p.metadata.ownerReferences?.some(o=>o.kind==='Job'&&o.uid===job.metadata.uid));
    if(pods.length>1)throw conflict('恢复 Job 出现多个执行 Pod，不能猜测哪次结果有效');
    const pod=pods[0],status=record(job.status),conditions=array(status.conditions),failed=conditions.some(c=>c.type==='Failed'&&c.status==='True'),complete=conditions.some(c=>c.type==='Complete'&&c.status==='True');
    let exitCode:number|null=null;
    if(pod){
      exactContainer(containerOf(pod,false),input);
      const states=array(record(pod.status).containerStatuses);if(states.length>1)throw conflict('恢复 Pod 执行容器数量变化');
      const runtime=states[0],ended=record(record(runtime?.state).terminated);
      if(runtime?.imageID&&String(runtime.imageID).match(/sha256:[a-f0-9]{64}$/)?.[0]!==input.image.split('@')[1])throw conflict('恢复 Pod 实际镜像摘要变化');
      if(typeof ended.exitCode==='number'){if(!runtime?.imageID)throw precondition('恢复 Pod 缺少实际镜像摘要');exitCode=ended.exitCode;}
    }
    if(failed&&(!pod?.metadata.uid||exitCode===null))throw precondition('失败恢复 Job 缺少原 Pod 已终止证明，不能新建尝试');
    const state=failed?'failed':complete?'succeeded':pod?'running':'pending';
    const proof:RestoreJobProof={receipt:{name:input.name,uid:job.metadata.uid,image:input.image,target:input.target,state,exitCode},secretUid:secret.metadata.uid,environmentDigest:jsonHash(actual),podUid:pod?.metadata.uid??null};
    if(state==='succeeded'){
      if(!pod?.metadata.uid||exitCode!==0)throw precondition('恢复 Job 缺少实际 Pod 成功退出证明');
      if(input.purpose==='database-verify')proof.verification=await receiptLog(k8s,input.namespace,pod.metadata.name,String(containerOf(pod,false).name));
    }
    const latest=await k8s.get(Resources.Job!,input.name,input.namespace);
    if(latest?.metadata.uid!==job.metadata.uid)throw conflict('记录回执时恢复 Job 已变化');
    return retainJobProof(input.previous,proof);
  }};
}
