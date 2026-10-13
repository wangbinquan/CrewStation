import type { ServiceId, TraceId, StartAgentTerminalCommand } from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { CliObservationParticipant } from '../../ports/cliObservation';
import type { DevelopmentUsageOwner } from '../../ports/developmentUsage';
import type { DevelopmentDispatchSession } from '../../ports/developmentDispatch';
import type { DevelopmentEndingSession, DevelopmentEndingStore } from '../../ports/developmentEnding';
import type { DevSessionUseCaseDeps } from '../dependencies';
import { profileLaunchFields } from '../profileLaunch';
import { dispatchDevelopmentAgent } from './dispatch';
import { advanceDevelopmentEnding, requestDevelopmentEnding } from './ending';
export function cliObservation(deps:DevSessionUseCaseDeps, ports:{owner:DevelopmentUsageOwner;dispatch:DevelopmentDispatchSession;ending:DevelopmentEndingSession;store:DevelopmentEndingStore}):CliObservationParticipant {
 const ending={owner:ports.owner,store:ports.store,session:ports.ending,clock:deps.clock};
 return {
  async prepare(start){const intent=start.execution?.observationIntent;if(!intent)return;const original=await ports.owner.get(start.execution!.taskId);const parent=await deps.environments.getEnvironment(start.taskId);if(!parent||parent.native)throw precondition('CLI 原项目工作区不存在');await ports.owner.prepare({intent,legacyFallbackAllowed:true,context:original?.context??{serviceId:parent.serviceId as ServiceId,traceId:parent.traceId as TraceId,branch:parent.branch??null}});},
  async dispatch(start){const result=await dispatchDevelopmentAgent({owner:ports.owner,session:ports.dispatch,material:async original=>{const i=original.intent,credential=await deps.credentials.issueDevSessionToken({taskId:start.taskId,projectId:i.identity.projectId,serviceId:original.context.serviceId,userId:start.createdBy});const launch=await profileLaunchFields(deps,start.profile,start.record.agentId);const command:StartAgentTerminalCommand={id:'start-cli-'+start.record.agentId,type:'startAgentTerminal',agentId:start.record.agentId,terminalId:start.record.terminalId,runnerId:start.record.runnerId,requestFingerprint:start.fingerprint,...launch,permission:i.permission,cols:start.input.cols,rows:start.input.rows,...(i.cwd===null?{}:{cwd:i.cwd}),mcp:i.mcp.map(m=>({...m,headers:{[IDENTITY_HEADERS.devSessionToken]:credential.token}})),env:{}};return command;}},start.execution!.taskId);return result.kind!=='legacy';},
  async end(start){const id=start.execution!.taskId,original=await ports.owner.get(id);if(!original||original.unsupported)return true;const reason=original.closeReason??'cancelled';const requested=await requestDevelopmentEnding(ending,id,reason);if(requested.kind==='waiting')return false;await advanceDevelopmentEnding(ending,id);return (await ports.store.get(id))?.stage==='evidence-complete';}
 };
}
