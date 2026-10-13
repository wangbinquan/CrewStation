import { DevelopmentUsageLookupSchema, TaskIdSchema, WorkloadConsumerSchema, WorkloadStopProofSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { DevelopmentCleanupSelectionSchema, developmentCleanupEvidence } from '../../domain/development/cleanup';
import type { DevelopmentCleanupSelection } from '../../domain/development/cleanup';
import {DevelopmentUnsupportedCliEvidenceSchema} from '../../domain/development/unsupportedCliCleanup';
import { DevelopmentPrestartCleanupEvidenceSchema } from '../../domain/development/prestartCleanup';
import type { DevelopmentCleanupDeps, DevelopmentCleanupParticipant } from '../../ports/developmentCleanup';
import { requestDevelopmentEnding, advanceDevelopmentEnding } from './ending';

async function inspectOriginal(deps: DevelopmentCleanupDeps, selection: DevelopmentCleanupSelection) {
  const id = TaskIdSchema.parse(selection.identity.executionId), owner = await deps.owner.get(id);
  if (!owner || (!owner.unsupported && !owner.binding && (!deps.workloadSafety || !deps.session.lookupDevelopmentUsage || !deps.store.inspectPrestart || !deps.store.completePrestart))) return undefined;
  const env = await deps.environments.getEnvironment(id), n = env?.native, i = owner.intent;
  if (jsonHash(i.identity) !== jsonHash(selection.identity) || i.profileId !== selection.profileId || i.profileRevision !== selection.profileRevision
    || owner.binding && (owner.binding.podUid !== selection.podUid || owner.binding.runtimeTaskId !== id) || !env || env.id !== id || env.projectId !== i.identity.projectId
    || !n || env.state !== 'releasing' || (n.purpose??'cli') !== (i.identity.sourceKind==='development-cli'?'cli':'agent') || n.state !== 'cleaning' || n.parentTaskId !== i.identity.taskId
    || n.agentId !== i.identity.agentId || n.podUid !== selection.podUid || (i.identity.sourceKind==='development-cli' ? !n.terminalId : n.terminalId !== undefined)) throw precondition('原开发 owner、Agent 与实际清理环境不匹配');
  return owner;
}
async function prestart(deps: DevelopmentCleanupDeps, selection: DevelopmentCleanupSelection, completing: boolean) {
  const id = TaskIdSchema.parse(selection.identity.executionId), original = await inspectOriginal(deps, selection);
  if (!original || original.binding || !deps.workloadSafety || !deps.session.lookupDevelopmentUsage || !deps.store.inspectPrestart || !deps.store.completePrestart)
    return { kind: 'waiting' as const, reason: 'prestart-capability' };
  await deps.closeOriginalAdmission?.(id);
  // Close unstarted admission; the original transaction retains any existing first reason.
  await requestDevelopmentEnding(deps, id, 'cancelled');
  // Re-read actual owner/start/job after the original null-binding close transaction.
  const owner = await inspectOriginal(deps, selection), job = await deps.store.inspectPrestart(selection);
  if (!owner || owner.binding || !owner.closeReason || job?.firstReason !== owner.closeReason
    || job.stop || job.closure || job.logicalResult) return { kind: 'waiting' as const, reason: 'prestart-owner' };
  const state = await deps.workloadSafety.get(selection.consumerId), env = await deps.environments.getEnvironment(id);
  if (!state?.admissionClosed || !await deps.workloadSafety.admissionClosed(selection.consumerId) || state.startPermit !== null)
    return { kind: 'waiting' as const, reason: 'prestart-no-grant' };
  const consumer = WorkloadConsumerSchema.parse(state.consumer);
  if (consumer.podName !== env?.podName) return { kind: 'waiting' as const, reason: 'prestart-consumer' };
  const lookup = DevelopmentUsageLookupSchema.parse(await deps.session.lookupDevelopmentUsage(id));
  if (lookup.kind !== 'absent' || lookup.runtimeTaskId !== id) return { kind: 'waiting' as const, reason: 'prestart-session' };
  const price = owner.price;
  const common = { version: 2, kind: 'unbound-no-grant', numericState: 'unknown', selection, consumer,
    owner: { payloadDigest: owner.payloadDigest, firstReason: job.firstReason, acceptedAt: price.acceptedAt,
      profileId: price.profile!.id, profileRevision: price.profile!.revision, protocol: price.profile!.protocol, priceBookRevision: price.priceBookRevision } };
  if (job.stage === 'prestart-closed') {
    const saved = DevelopmentPrestartCleanupEvidenceSchema.parse(job.prestartClosure);
    if (jsonHash({ ...saved, stopProof: null, stopProofDigest: null, phase: 'stopping' }) !== jsonHash({ ...common, phase: 'stopping', stopProof: null, stopProofDigest: null })
      || !state.stopProof || jsonHash(state.stopProof) !== jsonHash(saved.stopProof)) throw precondition('原未获准启动闭合已冲突');
    return { kind: 'permitted' as const, evidence: saved };
  }
  if (!completing) return { kind: 'permitted' as const, evidence: DevelopmentPrestartCleanupEvidenceSchema.parse({ ...common, phase: 'stopping', stopProof: null, stopProofDigest: null }) };
  if (!state.stopProof) return { kind: 'waiting' as const, reason: 'prestart-physical-proof' };
  const stopProof = WorkloadStopProofSchema.parse(state.stopProof);
  const evidence = DevelopmentPrestartCleanupEvidenceSchema.parse({ ...common, phase: 'closed', stopProof, stopProofDigest: jsonHash(stopProof) });
  const completed = await deps.store.completePrestart(evidence);
  if (completed?.stage !== 'prestart-closed') return { kind: 'waiting' as const, reason: 'prestart-commit' };
  return { kind: 'permitted' as const, evidence: DevelopmentPrestartCleanupEvidenceSchema.parse(completed.prestartClosure) };
}
async function guardedPrestart(deps: DevelopmentCleanupDeps, selection: DevelopmentCleanupSelection, completing: boolean) {
  try { return await prestart(deps, selection, completing); }
  catch { return { kind: 'waiting' as const, reason: 'prestart-original-evidence' }; }
}
async function unsupportedCli(deps:DevelopmentCleanupDeps,selection:DevelopmentCleanupSelection,complete:boolean){
 const id=TaskIdSchema.parse(selection.identity.executionId),owner=await inspectOriginal(deps,selection);
 if(!owner?.unsupported||!owner.unsupportedProof||owner.binding||!deps.workloadSafety||!deps.session.lookupDevelopmentUsage||!deps.owner.close)return {kind:'waiting' as const,reason:'legacy-cli-original'};
 await deps.owner.close(id,owner.closeReason??'cancelled');await deps.closeOriginalAdmission?.(id);
 const current=await inspectOriginal(deps,selection),state=await deps.workloadSafety.get(selection.consumerId),lookup=DevelopmentUsageLookupSchema.parse(await deps.session.lookupDevelopmentUsage(id));
 if(!current?.closeReason||!state?.admissionClosed||!await deps.workloadSafety.admissionClosed(selection.consumerId)||!state.startPermit||lookup.kind!=='absent'||lookup.runtimeTaskId!==id||current.unsupportedProof?.podUid!==selection.podUid)return {kind:'waiting' as const,reason:'legacy-cli-physical-admission'};
 const price=current.price,base={version:3,kind:'unsupported-cli',numericState:'unknown',selection,capability:current.unsupportedProof,consumer:state.consumer,startPermit:state.startPermit,owner:{payloadDigest:current.payloadDigest,firstReason:current.closeReason,acceptedAt:price.acceptedAt,profileId:price.profile!.id,profileRevision:price.profile!.revision,protocol:price.profile!.protocol,priceBookRevision:price.priceBookRevision}};
 if(complete&&!state.stopProof)return {kind:'waiting' as const,reason:'legacy-cli-physical-stop'};
 return {kind:'permitted' as const,evidence:DevelopmentUnsupportedCliEvidenceSchema.parse({...base,phase:complete?'closed':'stopping',stopProof:complete?state.stopProof:null,stopProofDigest:complete?jsonHash(state.stopProof):null})};
}
/** No timers, legacy fallback or physical I/O. Each replay rechecks the actual original PG copy. */
export function developmentCleanupParticipant(deps: DevelopmentCleanupDeps): DevelopmentCleanupParticipant {
  return { completePrestart: async(raw) => {const s=DevelopmentCleanupSelectionSchema.parse(raw);const o=await deps.owner.get(TaskIdSchema.parse(s.identity.executionId));return o?.unsupported?unsupportedCli(deps,s,true):guardedPrestart(deps,s,true);}, advance: async (raw) => {
    const selection = DevelopmentCleanupSelectionSchema.parse(raw), id = TaskIdSchema.parse(selection.identity.executionId);
    const original = await inspectOriginal(deps, selection);
    if (!original) return { kind: 'waiting', reason: 'unbound' };
    if(original.unsupported)return unsupportedCli(deps,selection,false);
    if (!original.binding) return guardedPrestart(deps, selection, false);
    await deps.closeOriginalAdmission?.(id);
    await requestDevelopmentEnding(deps, id, original.closeReason ?? 'cancelled');
    await advanceDevelopmentEnding(deps, id);
    const owner = await inspectOriginal(deps, selection), job = await deps.store.get(id);
    if (!owner?.binding || job?.stage !== 'evidence-complete') return { kind: 'waiting', reason: 'digital-ending' };
    const stored = await deps.session.getDevelopmentUsage(id, owner.binding.key);
    if (!stored?.closure) return { kind: 'waiting', reason: 'durable-copy' };
    return { kind: 'permitted', evidence: developmentCleanupEvidence(selection, owner, job, stored) };
  } };
}
