import { jsonHash, precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { SessionProcessSchema } from '../../../domain/projectDeletion';
import type { SessionDeletionSources } from '../../../ports/projectDeletion';

const podIdentity = SessionProcessSchema.pick({ podUid: true, nodeUid: true, nodeName: true });
/** Only the complete original protected Pod's physical stop can recover a vanished replica. Backend or connection absence is insufficient. */
export async function observeSessionTransports(db: Database, sources: SessionDeletionSources): Promise<void> {
  if (!sources.processes) return;
  await sources.processes.sweep({ stopped: async () => {}, podStopped: async (raw, digest) => {
    const process = podIdentity.parse(raw), identity = jsonHash(process);
    if (!/^[a-f0-9]{64}$/.test(digest)) throw precondition('会话原 Pod 停止摘要无效');
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('crewstation.session_pod_stop',${identity},true)`);
      await tx.execute(sql`INSERT INTO session.process_stops(identity,original_process,digest) VALUES(${identity},${JSON.stringify(process)}::jsonb,${digest}) ON CONFLICT DO NOTHING`);
      const original = (await tx.execute<{ digest: string }>(sql`SELECT digest FROM session.process_stops WHERE identity=${identity}`))[0]!;
      await tx.execute(sql`UPDATE session.connection_births SET exited_at=clock_timestamp(),exit_digest=identity,recovery_digest=${original.digest}
        WHERE original_process->>'podUid'=${process.podUid} AND original_process->>'nodeUid'=${process.nodeUid} AND original_process->>'nodeName'=${process.nodeName} AND exited_at IS NULL`);
    });
  }, releasable: async (podUid) => (await db.execute<{ releasable: boolean }>(sql`SELECT NOT EXISTS(SELECT 1 FROM session.connection_births
    WHERE original_process->>'podUid'=${podUid} AND exited_at IS NULL) AS releasable`))[0]?.releasable === true });
}
