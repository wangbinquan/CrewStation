import type {UsageNativeCapture,RuntimeNativePagedCapture,UsageRecord} from '@crewstation/contracts';
import {completeObservedIdentity,completeCaptureIdentity,completePagedCaptureIdentity,completeUsageCaptureIdentity,completePagedUsageCaptureIdentity} from '../completeRuntimeIdentity';
export const RUNTIME_NATIVE_GAPS=['native-capture-unobserved','native-capture-incomplete','usage-missing'] as const;
export function runtimeNativeQuality(c:UsageNativeCapture|RuntimeNativePagedCapture){
 if('sourceVersion' in c){const complete=c.pass.phase==='final'&&c.sourceState==='source-eof'&&c.pathsComplete&&c.workState==='processed'&&c.numericEof&&c.valuationEof&&c.heldSteps==='0'&&c.visitedSteps===c.counts.steps&&['complete-before','complete-birth'].includes(c.baselineState)&&!c.issues.length;
 return {identity:completeObservedIdentity(c.identity),captureIdentity:completePagedCaptureIdentity(c),included:c.pass.phase!=='baseline',complete,empty:c.counts.steps==='0'};}
 const p=c.proof,complete=c.state==='complete'&&p.state==='complete'&&!!p.root&&!!p.fingerprint&&!p.priorRevisionGap&&!p.issues.length&&!c.issues.length&&!c.historicalRevisionGap&&!c.revisedBaselineSteps&&!c.unresolvedBaselineSteps&&c.receivedSteps===p.emitted&&p.steps===p.emitted+p.baselineSteps;
 return {identity:completeObservedIdentity(c.identity),captureIdentity:completeCaptureIdentity(c),included:true,complete,empty:c.receivedSteps===0&&p.emitted===0&&p.steps===p.baselineSteps};
}
export function runtimeRecordCapture(record:UsageRecord){return completePagedUsageCaptureIdentity(record)??completeUsageCaptureIdentity(record);}
