import type {ProjectId} from '@crewstation/contracts';
import {jsonHash} from '@crewstation/kernel';
import type {CompleteReportSourceCollection} from '../../ports/completeRuntimeReportCache';

export interface DevelopmentCollectionAdmission {readonly projectId:string;readonly profileId:string;readonly profileRevision:number}
/** Capture installation metadata once. Historical execution traversal never uses this selection. */
export function developmentCollectionConfiguration(admissions:readonly DevelopmentCollectionAdmission[]|undefined) {
 const frozen=(admissions??[]).map(row=>({projectId:row.projectId,profileId:row.profileId,profileRevision:row.profileRevision})).sort((a,b)=>{
  const x=JSON.stringify(a),y=JSON.stringify(b);return x<y?-1:x>y?1:0;
 });
 return (projectId:ProjectId|null):CompleteReportSourceCollection|undefined=>{
  const selected=projectId===null?frozen:frozen.filter(row=>row.projectId===projectId);
  return selected.length?{development:'validation-selected',configurationDigest:jsonHash({version:2,admissions:selected})}:undefined;
 };
}
