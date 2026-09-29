import type { RunnerCommand, StoredDevelopmentUsage, TaskId } from '@crewstation/contracts';
import { DevelopmentUsageInfoSchema, DevelopmentUsagePageSchema, DevelopmentUsageReceiptSchema } from '@crewstation/contracts';
import { newResourceId, PlatformError } from '@crewstation/kernel';
import type { DevelopmentUsageStore } from '../ports/developmentUsage';
import { persistDevelopmentInfo } from './developmentUsageReceipt';

export interface DevelopmentUsageIngestionDeps { store: DevelopmentUsageStore; send(taskId: TaskId, command: RunnerCommand): Promise<unknown> }
/** PG commits precede every Runner ACK; interruption is independent of the ordinary model lifecycle. */
export async function ingestDevelopmentUsage(deps: DevelopmentUsageIngestionDeps, stream: StoredDevelopmentUsage): Promise<void> {
  const { runtimeTaskId: taskId, key, podUid } = stream.registration;
  try {
    const info = DevelopmentUsageInfoSchema.parse(await deps.send(taskId, { id: newResourceId(), type: 'developmentUsageInfo', key }));
    const receipt = await persistDevelopmentInfo(deps.store, stream, info);
    if (!receipt) return;
    let current = (await deps.store.get(taskId, key))!;
    if (current.persistedThrough < receipt.lastSequence) {
      const page = DevelopmentUsagePageSchema.parse(await deps.send(taskId, { id: newResourceId(), type: 'readDevelopmentUsageEvents', key, after: current.persistedThrough, limit: 5 }));
      current = await deps.store.ingest(taskId, receipt, page);
    }
    if (current.persistedThrough > current.runnerAcknowledgedThrough) {
      const ack = DevelopmentUsageReceiptSchema.parse(await deps.send(taskId, { id: newResourceId(), type: 'ackDevelopmentUsageEvents', key, through: current.persistedThrough }));
      await deps.store.ingest(taskId, ack);
      if (ack.acknowledgedSequence < current.persistedThrough) throw new Error('Runner did not confirm the copied development watermark');
      await deps.store.acknowledgeRunner(taskId, key, current.persistedThrough);
    }
  } catch (error) {
    // A bound journal-lost reply proves unavailable data. Network/PG errors still retry the same key.
    if (!(error instanceof PlatformError) || error.details?.code !== 'development_journal_lost') throw error;
    await deps.store.unavailable(taskId, { key, podUid, reason: 'journal-unavailable' });
  }
}
