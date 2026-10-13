import type {RuntimeAnomaly} from '@crewstation/contracts';
export interface RuntimeAnomalySample {rule:string;source:string;version:string;at:string;condition:boolean|null;samples:string;minimumSamples:string;durationMs:string;windowMs:string;evidence:Record<string,unknown>}
export interface RuntimeAnomalyState {document:RuntimeAnomaly;version:string;condition:boolean|null}
/** Source loss is distinct from business failure. Replays cannot increase samples or extend a healthy history backwards. */
export function advanceRuntimeAnomaly(previous:RuntimeAnomalyState|undefined,s:RuntimeAnomalySample,identity:Pick<RuntimeAnomaly,'id'|'key'|'projectId'|'taskId'|'taskName'>):RuntimeAnomalyState|undefined {
 if(previous && Date.parse(s.at)<Date.parse(previous.document.lastObservedAt))return previous;
 if(!previous && s.condition!==true)return undefined;
 const d=previous?.document,reset=s.condition===true && previous?.condition===false;
 const first=reset||!d?s.at:d.firstObservedAt,count=reset||!d?BigInt(s.samples):previous!.version===s.version?BigInt(d.samples):BigInt(d.samples)+BigInt(s.samples);
 const ready=s.condition===true&&count>=BigInt(s.minimumSamples)&&Date.parse(s.at)-Date.parse(first)>=Number(s.durationMs);
 const state=s.condition===false?'resolved':ready?'firing':s.condition===null?d?.state??'pending':d?.state==='firing'?'firing':'pending';
 return {version:s.version,condition:s.condition,document:{...identity,rule:s.rule,source:s.source,state,sourceState:s.condition===null?'unavailable':'available',firstObservedAt:first,lastObservedAt:s.at,firedAt:state==='firing'?(reset?s.at:d?.firedAt??s.at):(reset?null:d?.firedAt??null),resolvedAt:state==='resolved'?d?.resolvedAt??s.at:null,samples:String(count),minimumSamples:s.minimumSamples,durationMs:s.durationMs,windowMs:s.windowMs,evidence:s.evidence}};
}
