import { isIP } from 'node:net';
import type { K8sObject } from '@crewstation/k8s';
import { jsonHash } from '@crewstation/kernel';

/** Only the approved kubelet secondary host-address report can differ; every other original field remains exact. */
interface HostStatus {hostIP?:string;hostIPs?:Array<Record<string,unknown>>}
export function onlyReportedHostFamilyChanged(original:K8sObject,current:K8sObject) {
  if(original.kind!=='Pod'||current.kind!=='Pod')return false;
  const before=original['status'] as HostStatus|undefined,after=current['status'] as HostStatus|undefined;
  if(!before||!after||before.hostIP!==after.hostIP||before.hostIPs?.length===after.hostIPs?.length)return false;
  const complete=(status:HostStatus)=>{
    const host=status.hostIP,entries=status.hostIPs;
    return typeof host==='string'&&isIP(host)>0&&Array.isArray(entries)&&[1,2].includes(entries.length)&&entries.every((entry,index)=>
      entry&&typeof entry==='object'&&Object.keys(entry).length===1&&typeof entry['ip']==='string'&&isIP(entry['ip'])>0&&
      (index===0?entry['ip']===host:isIP(entry['ip'])!==isIP(host)));
  };
  if(!complete(before)||!complete(after))return false;
  const physical=(object:K8sObject)=>{
    const copy=structuredClone(object),metadata=copy.metadata as K8sObject['metadata']&{managedFields?:Array<Record<string,unknown>>};
    delete metadata.resourceVersion;delete (copy['status'] as HostStatus).hostIPs;
    for(const entry of metadata.managedFields??[]){
      const fields=entry['fieldsV1'] as Record<string,Record<string,unknown>>|undefined;
      if(entry['manager']==='kubelet'&&entry['operation']==='Update'&&entry['apiVersion']==='v1'&&entry['subresource']==='status'&&
        entry['fieldsType']==='FieldsV1'&&fields?.['f:status']?.['f:hostIPs']!==undefined)delete entry['time'];
    }
    return jsonHash(copy);
  };
  return physical(original)===physical(current);
}
