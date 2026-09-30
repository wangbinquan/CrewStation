import type { Database } from '@crewstation/persistence';
import type { DevelopmentUsageReceipt, DevelopmentUsageRegistration, RunnerCommand, RunnerHello, StartAgentCommand, StoredDevelopmentUsage, TaskId } from '@crewstation/contracts';
import { DevelopmentUsageReceiptSchema, StartAgentCommandSchema, StoredDevelopmentUsageSchema } from '@crewstation/contracts';
import type { DevelopmentDispatchDeps, DevelopmentDispatchSession } from '../ports/developmentDispatch';
import type { DevelopmentUsageOwnerRecord } from '../ports/developmentUsage';
import { developmentUsageFixture } from './developmentUsageFixture';

export async function developmentDispatchFixture(db: Database, options: { bound?: boolean; selected?: boolean } = {}) {
  const f = await developmentUsageFixture(db);
  f.preparation.intent.nativeSource = { version: 1 };
  if (options.selected !== false) await f.owner.prepare(f.preparation);
  if (options.bound) await f.owner.bind(f.child.id, f.info);
  const calls: RunnerCommand[] = [], registrations: DevelopmentUsageRegistration[] = [], stored = new Map<TaskId, StoredDevelopmentUsage>();
  const capabilities: RunnerHello['capabilities'] = { protocols: ['opencode'], pty: true, preview: false, usageObservationsV1: 1, developmentUsageV1: 1, developmentUsageStopV1: 1, developmentNativeSourceV1: 1, nativeUsageTreeV1: 1 };
  const control = { connected: true, capabilities: capabilities as RunnerHello['capabilities'] | undefined, info: structuredClone(f.info), materialCalls: 0, registerFailure: false,
    infoFailure: false, lostStartAck: false, holdEmpty: false, badStored: undefined as unknown, onMaterial: undefined as (() => Promise<void>) | undefined };
  const session: DevelopmentDispatchSession = {
    connectionStatus: async () => ({ connected: control.connected, capabilities: structuredClone(control.capabilities) }),
    registerDevelopmentUsage: async (registration) => {
      registrations.push(structuredClone(registration));
      if (control.registerFailure) throw new Error('temporary PG failure');
      if (!stored.has(registration.runtimeTaskId)) stored.set(registration.runtimeTaskId, StoredDevelopmentUsageSchema.parse({ registration, receipt: null, persistedThrough: 0, runnerAcknowledgedThrough: 0, sourceAcknowledgedThrough: 0, offeredThrough: 0, complete: false, drainReason: null, loss: null, closure: null }));
      return structuredClone(control.badStored ?? stored.get(registration.runtimeTaskId)) as StoredDevelopmentUsage;
    },
    sendCommand: async (_id, cmd) => {
      calls.push(structuredClone(cmd));
      if (cmd.type === 'developmentUsageInfo') {
        if (control.infoFailure) throw new Error('original Runner temporarily unreachable');
        return structuredClone(control.info);
      }
      if (cmd.type !== 'startAgent' || !cmd.developmentUsage) throw new Error('unexpected command');
      if (!control.holdEmpty) control.info.receipt = receipt(cmd.developmentUsage.intent.identity.agentId, cmd.developmentUsage.key);
      if (control.lostStartAck) throw new Error('accepted but ACK lost');
      return {};
    },
  };
  function receipt(agentId: string, key: DevelopmentUsageRegistration['key'], patch: Partial<DevelopmentUsageReceipt> = {}) {
    return DevelopmentUsageReceiptSchema.parse({ key, podUid: f.info.podUid, identity: { ...f.preparation.intent.identity, agentId }, profileId: f.start.profile.profileId, profileRevision: 2, phase: 'running', lastSequence: 0, acknowledgedSequence: 0, finalThrough: null, result: null, interruption: null, ...patch });
  }
  const makeCommand = (original: DevelopmentUsageOwnerRecord): StartAgentCommand => {
    const i = original.intent;
    return StartAgentCommandSchema.parse({ id: 'start-' + i.identity.agentId, type: 'startAgent', agentId: i.identity.agentId, compute: 'Original compute', profileRevision: i.profileRevision, launch: i.launch, permission: i.permission,
      mode: i.mode, initialPrompt: i.initialPrompt ?? undefined, cwd: i.cwd ?? undefined, resumeSessionId: i.resumeSessionId ?? undefined, mcp: i.mcp.map((m) => ({ ...m, headers: { authorization: 'synthetic-secret' } })),
      env: {}, beforeStart: { profile: i.profileId, revision: i.profileRevision, contentHash: 'fixed-template', steps: [], vars: {}, secrets: {}, configFile: { kind: 'none' } }, processAttemptId: i.identity.agentId + ':1' });
  };
  const deps: DevelopmentDispatchDeps = { owner: f.owner, session, material: async (original) => { control.materialCalls++; await control.onMaterial?.(); return makeCommand(original); } };
  const setReceipt = async (patch: Partial<DevelopmentUsageReceipt> = {}, persistent = false) => {
    const original = (await f.owner.get(f.child.id))!;
    const value = receipt(f.start.agentId, original.binding!.key, patch); control.info.receipt = value;
    if (persistent) {
      await session.registerDevelopmentUsage(original.binding!);
      stored.get(f.child.id)!.receipt = structuredClone(value);
    }
    return value;
  };
  return { ...f, deps, session, calls, registrations, stored, control, makeCommand, setReceipt, startsSent: () => calls.filter((c) => c.type === 'startAgent') };
}
