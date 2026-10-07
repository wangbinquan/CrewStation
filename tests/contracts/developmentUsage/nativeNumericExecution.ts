// Acceptance-only: actual WAL/journal/Session PG/ledger, controlled source values. No model invocation or supplier bill.
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestDatabase } from '../../../packages/testkit';
import { DevelopmentNativePreparationSchema, type DevelopmentUsageAdmission, type RunnerCommand, type DevelopmentUsageRegistration } from '../../../packages/contracts';
import { openNativeUsagePass, persistNativeUsagePass } from '../../../packages/agent-drivers';
import type { DevelopmentNativeObserver } from '../../../packages/agent-drivers/drivers/usage/developmentNativeObserver';
import { DevelopmentUsageJournal } from '../../../runtimes/task/src/agents/developmentUsageJournal';
import { developmentIntentDigest } from '../../../runtimes/task/src/agents/developmentStartIntent';
import { readDevelopmentNativePage as runnerPage } from '../../../runtimes/task/src/agents/developmentNativePageReader';
import type { drizzleDevelopmentUsageStore } from '../../../modules/session/adapters/persistence/developmentUsage';
import type { drizzleDevelopmentUsageSourceStore } from '../../../modules/session/adapters/persistence/developmentUsageSources';
import { ingestDevelopmentUsage } from '../../../modules/session/application/developmentUsageIngestion';
import { developmentRegistration } from '../../../modules/session/tests/developmentUsageFixtures';
import { prepareDevelopmentNativePacket } from '../../../modules/observability/domain/developmentUsage/packet';
import { drizzleUsageLedger } from '../../../modules/observability/adapters/persistence/drizzleUsageLedger';
import { jsonHash } from '../../../packages/kernel';
import type { NativeOriginalPageReader } from '../../../modules/observability/ports/nativeDevelopmentLedger';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface NativeNumericContext {
  database: TestDatabase; directory: string; path: string; root: string; podUid: string; journals: DevelopmentUsageJournal[];
  observer: DevelopmentNativeObserver; usage: ReturnType<typeof drizzleDevelopmentUsageStore>; sources: ReturnType<typeof drizzleDevelopmentUsageSourceStore>;
}
export async function nativeNumericExecution(context: NativeNumericContext, resume: boolean, original?: { identity: Pick<DevelopmentUsageRegistration['identity'], 'projectId' | 'taskId'> }) {
  const { database, directory, path, root, podUid, journals, observer, usage, sources } = context;
  const r = developmentRegistration(); r.podUid = podUid;
  if (original) { r.identity.projectId = original.identity.projectId; r.identity.taskId = original.identity.taskId; }
  const journalDir = join(directory, r.runtimeTaskId); await mkdir(journalDir, { mode: 0o700 });
  const journal = new DevelopmentUsageJournal(journalDir, { projectId: r.identity.projectId,
    workspaceTaskId: r.identity.taskId, runtimeTaskId: r.runtimeTaskId, podUid }, crypto.randomUUID()); journals.push(journal);
  const intent: DevelopmentUsageAdmission['intent'] = { version: 1, identity: r.identity, profileId: r.profileId, profileRevision: r.profileRevision,
    launch: { protocol: 'opencode', binaryPath: '/usr/bin/opencode', extraArgs: [], isSandbox: false }, permission: 'full', mode: 'oneshot',
    initialPrompt: null, cwd: null, resumeSessionId: resume ? root : null, systemPrompt: null, mcp: [],
    nativeUsageLineageKey: 'acceptance-native-lineage', nativeSource: { version: 2 } };
  const digestNonce = 'a'.repeat(64);
  r.key = { executionId: r.runtimeTaskId, journalId: journal.journalId, incarnation: journal.incarnation, payloadDigest: developmentIntentDigest({ intent, digestNonce }) };
  journal.reserve({ intent, digestNonce, key: r.key }); journal.running(r.key);
  const preparation = DevelopmentNativePreparationSchema.parse({ turn: 'actual-turn-' + r.runtimeTaskId, turnIndex: resume ? 1 : 0,
    rootSessionId: root, observedAt: new Date().toISOString(), store: observer.inspect() });
  await usage.register(r);
  const persist = async (phase: 'baseline' | 'final', pageRows = 1000) => {
    const identity = { passId: crypto.randomUUID(), turn: preparation.turn, nativeSource: 'opencode:' + preparation.store.actualPathDigest,
      sourceGeneration: hash(preparation.store), rootSessionId: root, lineageKey: intent.nativeUsageLineageKey,
      epoch: preparation.store.sourceEpoch, phase };
    const reader = openNativeUsagePass(path, identity, { pageRows, pageBytes: 512 * 1024 });
    try { return await persistNativeUsagePass(reader, journal.nativeOwner(r.key, preparation)); } finally { reader.close(); }
  };
  const send = async (_id: typeof r.runtimeTaskId, command: RunnerCommand) => {
    if (command.type === 'developmentUsageInfo') return journal.info(command.key);
    if (command.type === 'readDevelopmentUsageEvents') return journal.read(command.key, command.after, command.limit);
    if (command.type === 'readDevelopmentNativePage') return runnerPage(journal, command.key, command.passId, command.ordinal, command.afterByte);
    if (command.type === 'ackDevelopmentUsageEvents') return journal.acknowledge(command.key, command.through);
    throw new Error('Unexpected validation-only native command');
  };
  const copySession = async () => {
    for (;;) {
      const row = (await usage.get(r.runtimeTaskId, r.key))!;
      if (row.persistedThrough === journal.info(r.key).receipt!.lastSequence && row.runnerAcknowledgedThrough === row.persistedThrough) break;
      await ingestDevelopmentUsage({ store: usage, send }, row);
    }
  };
  const copy = async () => {
    await copySession();
    const ledger = drizzleUsageLedger(database.db), passKeys = new Set<string>(), scope = { projectId: r.identity.projectId, taskId: r.identity.taskId };
    for (;;) {
      const page = await sources.offer!(r.key); if (!page) break;
      await ledger.changeDevelopment(scope, 'development:' + jsonHash(r), async tx => {
        for (const event of page.events) {
          if (event.capture.version !== 2) throw new Error('Actual v2 source required');
          const ack = event.capture.nativeSource.ack, original = await sources.nativePage!(r.key, ack.identity.passId, ack.ordinal);
          if (!original) throw new Error('Actual Session PG raw copy required');
          const packet = prepareDevelopmentNativePacket({ key: r.key, registration: r, ownerRegistration: structuredClone(r),
            selection: { version: 2, expectedNamespace: intent.nativeUsageLineageKey }, original, event });
          const result = await tx.developmentPacket(packet); passKeys.add(result.passKey);
        }
        await tx.advance('development:' + page.through, jsonHash(page));
      });
      await sources.acknowledge(r.key, page.through);
    }
    return { passKeys: [...passKeys], scope, sourceId: 'development:' + jsonHash(r) };
  };
  return { registration: r, journal, preparation, persist, copy, copySession,
    read: async (pass: Parameters<NativeOriginalPageReader>[0], ordinal: string) => {
      const originalPage = await sources.nativePage!(pass.document.key, pass.progress.identity.passId, ordinal);
      if (!originalPage) throw new Error('Actual retained Session PG page missing after ordinary ACK'); return originalPage;
    } };
}
