import { sql } from 'drizzle-orm';
import { conflict } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';

export async function assertTransferOwnerActive(tx: Executor, owner: string): Promise<void> {
  const podUid = owner.split(':')[0];
  if (!owner.includes(':')) return; // Non-cluster test and operator owners cannot gain a Kubernetes stop proof.
  const stopped = await tx.execute(sql`SELECT pod_uid FROM data.object_transfer_stops WHERE pod_uid=${podUid}`);
  if (stopped.length) throw conflict('原对象传输进程已经确认退出');
}
