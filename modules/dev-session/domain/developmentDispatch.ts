import type { DevelopmentStartIntent, DevelopmentUsageReceipt, DevelopmentUsageRegistration, RunnerHello, StartAgentCommand, StartAgentTerminalCommand } from '@crewstation/contracts';
import { DevelopmentStartIntentSchema, DevelopmentUsageInfoSchema, DevelopmentUsageReceiptSchema, StartAgentCommandSchema, StartAgentTerminalCommandSchema } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { developmentOwnerIntentDigest } from './developmentUsage';

interface DevelopmentDispatchOriginal { intent: DevelopmentStartIntent; binding: DevelopmentUsageRegistration | null; digestNonce: string }
export type DevelopmentDispatchWaiting = 'disconnected' | 'unknown-capabilities' | 'source-unavailable' | 'source-conflict' | 'session-conflict' | 'receipt-regressed' | 'command-conflict' | 'admission-changed' | 'awaiting-receipt' | 'retry';
export type DevelopmentDispatchDecision =
  | { kind: 'empty' }
  | { kind: 'waiting'; reason: DevelopmentDispatchWaiting }
  | { kind: 'accepted'; receipt: DevelopmentUsageReceipt }
  /** A logical result only: this receipt proves neither physical exit nor an actual end timestamp. */
  | { kind: 'terminal'; receipt: DevelopmentUsageReceipt; actualEndedAt: null };

export function developmentReceiptMatches(registration: DevelopmentUsageRegistration, raw: unknown): boolean {
  const parsed = DevelopmentUsageReceiptSchema.safeParse(raw);
  if (!parsed.success) return false;
  const receipt = parsed.data;
  return jsonHash(receipt.key) === jsonHash(registration.key) && receipt.podUid === registration.podUid
    && jsonHash(receipt.identity) === jsonHash(registration.identity)
    && receipt.profileId === registration.profileId && receipt.profileRevision === registration.profileRevision;
}
export function developmentReceiptDecision(registration: DevelopmentUsageRegistration, raw: unknown): DevelopmentDispatchDecision {
  if (!developmentReceiptMatches(registration, raw)) return { kind: 'waiting', reason: 'source-conflict' };
  const receipt = DevelopmentUsageReceiptSchema.parse(raw);
  if (receipt.phase === 'finished') return { kind: 'terminal', receipt, actualEndedAt: null };
  if (receipt.phase === 'unknown') return { kind: 'waiting', reason: 'source-unavailable' };
  return { kind: 'accepted', receipt };
}
export function developmentInfoDecision(registration: DevelopmentUsageRegistration, raw: unknown): DevelopmentDispatchDecision {
  const parsed = DevelopmentUsageInfoSchema.safeParse(raw);
  if (!parsed.success) return { kind: 'waiting', reason: 'source-conflict' };
  const info = parsed.data;
  if (info.runtimeTaskId !== registration.runtimeTaskId || info.podUid !== registration.podUid || info.journalId !== registration.key.journalId)
    return { kind: 'waiting', reason: 'source-conflict' };
  // Connection incarnation may change on a restart; a durable receipt still retains the ORIGINAL key.
  if (info.receipt) return developmentReceiptDecision(registration, info.receipt);
  return info.incarnation === registration.key.incarnation ? { kind: 'empty' } : { kind: 'waiting', reason: 'source-conflict' };
}
export function developmentCapabilitiesSupported(original: DevelopmentDispatchOriginal, capabilities: RunnerHello['capabilities']): boolean {
  return (original.intent.identity.sourceKind !== 'development-cli' || capabilities.developmentNativeCliV2 === 2) && capabilities.developmentUsageV1 === 1 && capabilities.developmentUsageStopV1 === 1 && capabilities.usageObservationsV1 === 1
    && (!original.intent.nativeSource || (capabilities.developmentNativeSourceV1 === 1 && capabilities.nativeUsageTreeV1 === 1))
    && (original.intent.nativeSource?.version !== 2 || capabilities.developmentNativePagesV2 === 2);
}
/** Check the normalized original intent before sending any launch material. */
export function developmentDispatchCommand(original: DevelopmentDispatchOriginal, raw: StartAgentCommand | StartAgentTerminalCommand): StartAgentCommand | StartAgentTerminalCommand | undefined {
  if(raw.type==='startAgentTerminal') return developmentCliCommand(original,raw);
  if (!original.binding || raw.businessOutputContract !== undefined || (raw.businessSkills?.length ?? 0) > 0 || raw.businessSecretEnvNames !== undefined) return undefined;
  const admission = { intent: original.intent, key: original.binding.key, digestNonce: original.digestNonce };
  if (raw.developmentUsage && jsonHash(raw.developmentUsage) !== jsonHash(admission)) return undefined;
  const parsed = StartAgentCommandSchema.strict().safeParse({ ...raw, developmentUsage: admission });
  if (!parsed.success) return undefined;
  const command = parsed.data, intent = original.intent;
  const actual = DevelopmentStartIntentSchema.safeParse({ ...intent, identity: { ...intent.identity, agentId: command.agentId },
    profileRevision: command.profileRevision, launch: command.launch, permission: command.permission, mode: command.mode,
    initialPrompt: command.initialPrompt ?? null, cwd: command.cwd ?? null, resumeSessionId: command.resumeSessionId ?? null,
    systemPrompt: command.systemPrompt ?? null, mcp: command.mcp.map(({ name, url }) => ({ name, url })) });
  if (!actual.success || jsonHash(actual.data) !== jsonHash(intent) || developmentOwnerIntentDigest(original) !== admission.key.payloadDigest
    || command.beforeStart.profile !== intent.profileId || command.beforeStart.revision !== intent.profileRevision
    || command.processAttemptId !== intent.identity.agentId + ':1') return undefined;
  return command;
}

/** CLI material is checked against its own frozen purpose, never converted to headless. */
function developmentCliCommand(original: DevelopmentDispatchOriginal, raw: StartAgentTerminalCommand): StartAgentTerminalCommand | undefined {
 const i=original.intent;if(!original.binding || i.mode!=='cli' || i.identity.sourceKind!=='development-cli') return undefined;
 const admission={intent:i,key:original.binding.key,digestNonce:original.digestNonce};
 if(raw.developmentUsage && jsonHash(raw.developmentUsage)!==jsonHash(admission)) return undefined;
 const parsed=StartAgentTerminalCommandSchema.strict().safeParse({...raw,developmentUsage:admission});if(!parsed.success)return undefined;
 const c=parsed.data;
 if(c.agentId!==i.identity.agentId || c.compute!==i.profileId || c.profileRevision!==i.profileRevision || c.permission!==i.permission || (c.cwd??null)!==i.cwd || jsonHash(c.launch)!==jsonHash(i.launch) || jsonHash(c.mcp.map(({name,url})=>({name,url})))!==jsonHash(i.mcp) || c.beforeStart.profile!==i.profileId || c.beforeStart.revision!==i.profileRevision || c.processAttemptId!==i.identity.agentId+':1' || developmentOwnerIntentDigest(original)!==admission.key.payloadDigest)return undefined;
 return c;
}
