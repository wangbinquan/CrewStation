import type { ProjectId } from '@crewstation/contracts';
import { conflict, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { DeliveryProcess } from '../../ports/deliveryProcesses';

export async function beginDeliveryWork(db: Database, deliveryId: string, backend: number, process?: DeliveryProcess): Promise<number> {
  return db.transaction(async (tx) => {
    const created = await tx.execute(sql`INSERT INTO events.deletion_work(delivery_id,backend_pid,generation,state,pod_uid,container_id,node_uid,node_name) VALUES (${deliveryId},${backend},1,'running',${process?.podUid ?? null},${process?.containerId ?? null},${process?.nodeUid ?? null},${process?.nodeName ?? null}) ON CONFLICT DO NOTHING RETURNING delivery_id`);
    if (created.length) return 1;
    const [row] = await tx.execute<{ generation: number; state: string }>(sql`SELECT generation,state FROM events.deletion_work WHERE delivery_id=${deliveryId} FOR UPDATE`);
    if (!row) throw precondition('原投递在途身份缺失');
    if (row.state !== 'finished') throw conflict('原事件投递仍在执行，等待实际回调退出或原容器停止证明');
    const generation = row.generation+1;
    await tx.execute(sql`UPDATE events.deletion_work SET backend_pid=${backend},generation=${generation},state='running',pod_uid=${process?.podUid ?? null},container_id=${process?.containerId ?? null},node_uid=${process?.nodeUid ?? null},node_name=${process?.nodeName ?? null},proof_digest=NULL WHERE delivery_id=${deliveryId}`);
    return generation;
  });
}
export async function finishDeliveryWork(db: Database, deliveryId: string, generation: number, backend: number) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('crewstation.events_work_exit',${`${deliveryId}:${generation}:${backend}`},true)`);
    await tx.execute(sql`UPDATE events.deletion_work SET state='finished' WHERE delivery_id=${deliveryId} AND generation=${generation} AND backend_pid=${backend} AND state='running'`);
  });
}
export async function deliveryWorkPending(db: Executor, projectId: ProjectId) {
  const [row] = await db.execute<{ pending: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM events.deletion_work w JOIN events.deletion_links l ON l.kind='delivery' AND l.entity_key=w.delivery_id WHERE l.project_id=${projectId} AND w.state='running') AS pending`);
  return row?.pending !== false;
}
/** 只接收实际原容器终止来源的摘要，不依据连接、队列租约或同名替换实例。 */
export async function recoverDeliveryProcess(db: Database, process: DeliveryProcess, digest: string) {
  if (!process.podUid || !process.containerId || !process.nodeUid || !process.nodeName || !/^[a-f0-9]{64}$/.test(digest)) throw precondition('原投递容器停止证明不完整');
  await db.transaction(async (tx) => {
    await tx.execute(sql`INSERT INTO events.deletion_process_stops VALUES (${process.podUid},${process.containerId},${process.nodeUid},${process.nodeName},${digest}) ON CONFLICT DO NOTHING`);
    const [receipt] = await tx.execute<{ proof_digest: string }>(sql`SELECT proof_digest FROM events.deletion_process_stops WHERE pod_uid=${process.podUid} AND container_id=${process.containerId} AND node_uid=${process.nodeUid} AND node_name=${process.nodeName}`);
    const rows = await tx.execute<{ delivery_id: string; generation: number; backend_pid: number }>(sql`SELECT delivery_id,generation,backend_pid FROM events.deletion_work WHERE pod_uid=${process.podUid} AND container_id=${process.containerId} AND node_uid=${process.nodeUid} AND node_name=${process.nodeName} AND state='running' ORDER BY delivery_id FOR UPDATE`);
    for (const row of rows) {
      await tx.execute(sql`SELECT set_config('crewstation.events_work_exit',${`${row.delivery_id}:${row.generation}:${row.backend_pid}`},true)`);
      await tx.execute(sql`UPDATE events.deletion_work SET state='finished',proof_digest=${receipt!.proof_digest} WHERE delivery_id=${row.delivery_id} AND generation=${row.generation} AND state='running'`);
    }
  });
}
export async function deliveryProcessReleasable(db: Executor, podUid: string): Promise<boolean> {
  const [row] = await db.execute<{ pending: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM events.deletion_work WHERE pod_uid=${podUid} AND state='running') AS pending`);
  return row?.pending === false;
}
