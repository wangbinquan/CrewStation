import {isIP} from 'node:net';
import {dirname,posix} from 'node:path';
import {Resources} from '@crewstation/k8s';
import type {K8sClient,K8sObject,ResourceRef} from '@crewstation/k8s';
import {precondition} from '@crewstation/kernel';
import {freshPlatformNode} from '../platformPodTermination';

export interface RegistrySourceOptions {namespace:string;service:string;port:number;container:string;imageDigest:string;probeRoot:string;probePort:number;probeToken:string;consumerBirth?:{readonly baseUrl:string;readonly token:string}}
interface Mount {name:string;mountPath:string;readOnly?:boolean;subPath?:string;subPathExpr?:string}
interface Container {name:string;command?:string[];args?:string[];env?:Array<{name:string;value?:string;valueFrom?:unknown}>;volumeMounts?:Mount[]}
interface Spec {nodeName?:string;containers?:Container[];volumes?:Array<{name:string;persistentVolumeClaim?:{claimName:string};hostPath?:{path:string;type?:string}}>}
interface Status {podIP?:string;conditions?:Array<{type:string;status:string}>;containerStatuses?:Array<{name:string;containerID?:string;imageID?:string;ready?:boolean;state?:{running?:unknown}}>}
const slices:ResourceRef={apiVersion:'discovery.k8s.io/v1',kind:'EndpointSlice',plural:'endpointslices',namespaced:true};
export const registryUnavailable=(message:string)=>precondition(message,{code:'native_registry_source_unavailable'});
const unsupported=(message:string)=>precondition(message,{code:'native_registry_source_unsupported'});
export async function completeRegistryObjects(k8s:K8sClient,ref:ResourceRef,namespace:string|undefined,selector:string,signal:AbortSignal) {
  const result:K8sObject[]=[],cursors=new Set<string>();let cursor:string|undefined,version:string|undefined;
  do {
    const page=await k8s.listPage(ref,namespace,{labelSelector:selector,limit:100,signal,...(cursor?{continue:cursor}:{})});
    if(!page.resourceVersion||version&&page.resourceVersion!==version)throw registryUnavailable('Registry 原来源分页世代变化');
    version=page.resourceVersion;result.push(...page.items);cursor=page.continue||undefined;
    if(result.length>10_000||cursor&&cursors.has(cursor))throw registryUnavailable('Registry 原来源分页不完整');
    if(cursor)cursors.add(cursor);
  }while(cursor);
  return result;
}
export async function registryServer(k8s:K8sClient,options:RegistrySourceOptions,signal:AbortSignal) {
  const namespace=await k8s.get(Resources.Namespace!,options.namespace,undefined,signal),service=await k8s.get(Resources.Service!,options.service,options.namespace,signal);
  const spec=service?.['spec'] as {selector?:Record<string,string>;ports?:Array<{port:number;targetPort?:number|string}>}|undefined;
  if(!namespace?.metadata.uid||namespace.metadata.deletionTimestamp||!service?.metadata.uid||service.metadata.deletionTimestamp||!spec?.ports?.some(p=>p.port===options.port)||!spec.selector||!Object.keys(spec.selector).length)throw registryUnavailable('Registry 原命名空间／服务不可核实');
  const endpoints=await completeRegistryObjects(k8s,slices,options.namespace,'kubernetes.io/service-name='+options.service,signal),matches:Array<{name:string;uid:string;address:string}>=[];
  for(const slice of endpoints) {
    if(!slice.metadata.uid||slice.metadata.deletionTimestamp||!slice.metadata.ownerReferences?.some(r=>r.kind==='Service'&&r.uid===service.metadata.uid))throw registryUnavailable('Registry 端点不属于原服务');
    const ports=slice['ports'] as Array<{port?:number}>|undefined;
    for(const endpoint of slice['endpoints'] as Array<{addresses?:string[];conditions?:{ready?:boolean;terminating?:boolean};targetRef?:{kind?:string;namespace?:string;name?:string;uid?:string}}>??[]) {
      const ref=endpoint.targetRef;
      if(endpoint.conditions?.ready!==true||endpoint.conditions.terminating||ref?.kind!=='Pod'||ref.namespace!==options.namespace||!ref.name||!ref.uid||endpoint.addresses?.length!==1||!isIP(endpoint.addresses[0]!)||!ports?.some(p=>p.port===options.port))throw registryUnavailable('Registry 原端点缺少唯一就绪 Pod');
      matches.push({name:ref.name,uid:ref.uid,address:endpoint.addresses[0]!});
    }
  }
  if(matches.length!==1)throw registryUnavailable('Registry 原服务实例不能唯一匹配');
  const match=matches[0]!,pod=await k8s.get(Resources.Pod!,match.name,options.namespace,signal),status=pod?.['status'] as Status|undefined;
  const selector=Object.entries(spec.selector).sort().map(([k,v])=>k+'='+v).join(','),selected=await completeRegistryObjects(k8s,Resources.Pod!,options.namespace,selector,signal);
  if(!pod||pod.metadata.uid!==match.uid||pod.metadata.deletionTimestamp||status?.podIP!==match.address||!status.conditions?.some(c=>c.type==='Ready'&&c.status==='True')||selected.length!==1||selected[0]?.metadata.uid!==match.uid)throw registryUnavailable('Registry 原服务路由或实例变化');
  const node=await freshPlatformNode(k8s,pod);if(!node)throw registryUnavailable('Registry 原节点不新鲜');
  return {namespace,service,pod,node};
}
export async function registryStorage(k8s:K8sClient,options:RegistrySourceOptions,pod:K8sObject,signal:AbortSignal) {
  const spec=pod['spec'] as Spec,status=pod['status'] as Status,containers=spec.containers?.filter(c=>c.name===options.container);
  const container=containers?.[0],actual=status.containerStatuses?.find(c=>c.name===options.container);
  if(containers?.length!==1||!container||container.command?.length||container.args?.length||!actual?.ready||!actual.state?.running||!actual.containerID||!actual.imageID?.endsWith('@'+options.imageDigest))throw unsupported('Registry 原运行镜像或标准入口未核实');
  const roots=container.env?.filter(e=>e.name==='REGISTRY_STORAGE_FILESYSTEM_ROOTDIRECTORY'),root=roots?.[0]?.value;
  if(roots?.length!==1||roots[0]?.valueFrom||!root||!posix.isAbsolute(root))throw unsupported('Registry 真实 filesystem root 未核实');
  const mounts=container.volumeMounts?.filter(m=>m.mountPath===root),mount=mounts?.[0];
  if(mounts?.length!==1||!mount||mount.subPath||mount.subPathExpr||container.volumeMounts?.some(m=>m.mountPath.startsWith(root+'/')))throw unsupported('Registry 原存储不是完整单卷挂载');
  const claim=spec.volumes?.find(v=>v.name===mount.name)?.persistentVolumeClaim?.claimName;
  const pvc=claim?await k8s.get(Resources.PersistentVolumeClaim!,claim,options.namespace,signal):undefined,pvcSpec=pvc?.['spec'] as {volumeName?:string}|undefined;
  const pv=pvcSpec?.volumeName?await k8s.get(Resources.PersistentVolume!,pvcSpec.volumeName,undefined,signal):undefined,pvSpec=pv?.['spec'] as {claimRef?:{uid?:string;name?:string;namespace?:string};hostPath?:{path:string};local?:{path:string};csi?:unknown}|undefined;
  if(!pvc?.metadata.uid||pvc.metadata.deletionTimestamp||!pv?.metadata.uid||pv.metadata.deletionTimestamp||pvSpec?.claimRef?.uid!==pvc.metadata.uid||pvSpec.claimRef.name!==claim||pvSpec.claimRef.namespace!==options.namespace)throw registryUnavailable('Registry 原 PVC/PV 绑定变化');
  if(pvSpec.csi||pv.metadata.annotations?.['pv.kubernetes.io/provisioned-by']!=='rancher.io/local-path')throw unsupported('Registry 卷供应器没有原来源适配器');
  const path=pvSpec.hostPath?.path??pvSpec.local?.path;
  if(!path||dirname(path)!==options.probeRoot||pv.metadata.annotations?.['local.path.provisioner/selected-node']!==spec.nodeName)throw registryUnavailable('Registry 原卷物理位置／节点不符');
  return {pvc,pv,path,mountPath:root,containerId:actual.containerID,imageId:actual.imageID};
}
export async function registryProbe(k8s:K8sClient,options:RegistrySourceOptions,nodeName:string,signal:AbortSignal) {
  const probes=(await completeRegistryObjects(k8s,Resources.Pod!,options.namespace,'app=cs-storage-probe',signal)).filter(pod=>{
    const spec=pod['spec'] as Spec,status=pod['status'] as Status,volume=spec.volumes?.find(v=>v.hostPath?.path===options.probeRoot&&v.hostPath.type==='Directory');
    return pod.metadata.uid&&!pod.metadata.deletionTimestamp&&spec.nodeName===nodeName&&status.podIP&&isIP(status.podIP)&&status.conditions?.some(c=>c.type==='Ready'&&c.status==='True')
      &&volume&&spec.containers?.some(c=>c.volumeMounts?.some(m=>m.name===volume.name&&m.mountPath==='/volumes'&&m.readOnly&&!m.subPath&&!m.subPathExpr));
  });
  if(probes.length!==1)throw registryUnavailable('Registry 原节点只读来源探针不可用');
  return {pod:probes[0]!,address:(probes[0]!['status'] as Status).podIP!};
}
