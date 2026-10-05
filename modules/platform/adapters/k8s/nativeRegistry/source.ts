import {isIP} from 'node:net';
import {basename,isAbsolute} from 'node:path';
import {createRegistryInventoryClient} from '@crewstation/filesystem-metrics';
import type {RegistryInventoryRequest} from '@crewstation/filesystem-metrics';
import {Resources} from '@crewstation/k8s';
import type {K8sClient,K8sObject} from '@crewstation/k8s';
import {jsonHash,conflict} from '@crewstation/kernel';
import {freshPlatformNode} from '../platformPodTermination';
import {registryProbe,registryServer,registryStorage,registryUnavailable} from './origin';
import type {RegistrySourceOptions} from './origin';

export type RegistryInventoryQuery=Pick<RegistryInventoryRequest,'exact'|'prefixes'|'retainedDigests'|'retainedManifests'>;
/** Read-only bridge to the actual service, runtime image, volume and node probe; no writer/erasure claim. */
export function nativeRegistrySource(k8s:K8sClient,raw:RegistrySourceOptions,fetcher:typeof fetch=fetch) {
  const options={...raw};
  if(options.probeToken.length<32||!isAbsolute(options.probeRoot)||!/^sha256:[a-f0-9]{64}$/.test(options.imageDigest)||![options.port,options.probePort].every(p=>Number.isInteger(p)&&p>0&&p<=65535))throw registryUnavailable('Registry 原来源配置不完整');
  const capture=async (rawQuery:RegistryInventoryQuery,callerSignal?:AbortSignal)=>{
    const query=structuredClone(rawQuery);
    const signal=AbortSignal.any([...(callerSignal?[callerSignal]:[]),AbortSignal.timeout(40_000)]),server=await registryServer(k8s,options,signal);
    const volume=await registryStorage(k8s,options,server.pod,signal),probe=await registryProbe(k8s,options,server.node.name,signal);
    const client=createRegistryInventoryClient({baseUrl:`http://${isIP(probe.address)===6?'['+probe.address+']':probe.address}:${options.probePort}`,token:options.probeToken,
      fetch:(url,init)=>fetcher(url,init)});
    const started=Date.now(),key=jsonHash({namespace:server.namespace.metadata.uid,service:server.service.metadata.uid,pvc:volume.pvc.metadata.uid,pv:volume.pv.metadata.uid,query});
    const inventory=await client.observe({key,rootId:'local',directory:basename(volume.path),...query},signal);
    if(Date.parse(inventory.observedAt)<started-5000||Date.parse(inventory.observedAt)>Date.now()+5000)throw registryUnavailable('Registry 原盘点时间不符');
    const current=await registryServer(k8s,options,signal),currentVolume=await registryStorage(k8s,options,current.pod,signal);
    const pinned:K8sObject[]=[server.namespace,server.service,server.pod,volume.pvc,volume.pv,probe.pod];
    if(current.pod.metadata.uid!==server.pod.metadata.uid||currentVolume.containerId!==volume.containerId||currentVolume.imageId!==volume.imageId)throw registryUnavailable('Registry 原运行实例在盘点期间变化');
    for(const original of pinned) {
      const actual=await k8s.get(Resources[original.kind]!,original.metadata.name,original.metadata.namespace,signal);
      if(!original.metadata.resourceVersion||!actual||actual.metadata.uid!==original.metadata.uid||actual.metadata.resourceVersion!==original.metadata.resourceVersion||actual.metadata.deletionTimestamp)throw registryUnavailable('Registry 原挂载／来源探针在盘点期间变化');
    }
    if((await freshPlatformNode(k8s,server.pod))?.uid!==server.node.uid)throw registryUnavailable('Registry 原节点在盘点期间变化');
    const origin={namespaceUid:server.namespace.metadata.uid!,serviceUid:server.service.metadata.uid!,podUid:server.pod.metadata.uid!,containerId:volume.containerId,imageId:volume.imageId,
      nodeUid:server.node.uid,nodeName:server.node.name,pvcUid:volume.pvc.metadata.uid!,pvUid:volume.pv.metadata.uid!,providerPath:volume.path,mountPath:volume.mountPath,
      rootEpoch:inventory.rootIdentity,volumeEpoch:inventory.volumeIdentity,probeUid:probe.pod.metadata.uid!};
    return {identity:jsonHash(origin),origin,inventory};
  };
  return {capture,verify:async (query:RegistryInventoryQuery,original:{identity:string},signal?:AbortSignal)=>{
    const current=await capture(query,signal);if(current.identity!==original.identity)throw conflict('Registry 原实例或存储来源已替换',{code:'native_registry_source_changed'});return current;
  }};
}
