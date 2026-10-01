import type { ProjectId } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { Database, Executor, Transaction } from '@crewstation/persistence';
import { assertSharedDatabaseAdmissionActive, withSharedDatabaseAdmission } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { NativeDdlConnection, NativePostgresOrigin, NativePostgresProcess, NativePostgresProcesses, NativePostgresWork } from '../../api/databaseRemoval';
import { withNativePostgresNames } from '../postgres/nativeNames';

export const nativeAdmissionKey = (id: string) => 'data-control.project-admission:' + id;
async function open(db: Executor, projectId: ProjectId, available?: (id: ProjectId) => Promise<void>) {
  const [row] = await db.execute<{ operation_id: string | null }>(sql`SELECT operation_id FROM data_control.deletion_fences WHERE project_id=${projectId}`);
  if (row?.operation_id) throw precondition('项目数据库正在永久清理，不能建库、授予访问、续发口令或轮换');
  await available?.(projectId);
}
export async function markNativeCredentialTransaction(transaction: Executor, guard: Executor) {
  const [row] = await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
  if (!row) throw precondition('数据库口令准入来源缺失');
  await transaction.execute(sql`SELECT set_config('crewstation.data_control_admission_pid',${String(row.pid)},true)`);
}

/** Durable original callback facts survive loss of the main admission connection. */
export function nativePostgresWork(input: { db: Database; adminUrl: string; available?: (id: ProjectId) => Promise<void>; processes?: NativePostgresProcesses }) {
  const { db } = input;
  const withResource = async <T>(origin: NativePostgresOrigin, work: (guard: Transaction) => Promise<T>): Promise<T> => {
    if (!origin?.projectId || !origin.resourceId) throw precondition('原数据库写入缺少项目和资源身份');
    return withSharedDatabaseAdmission(db, nativeAdmissionKey(origin.projectId), async (guard) => {
      await open(guard, origin.projectId, input.available);
      await db.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO data_control.deletion_entities(resource_id,project_id) VALUES (${origin.resourceId},${origin.projectId}) ON CONFLICT DO NOTHING`);
        const [owner] = await tx.execute<{ project_id: ProjectId }>(sql`SELECT project_id FROM data_control.deletion_entities WHERE resource_id=${origin.resourceId}`);
        if (owner?.project_id !== origin.projectId) throw precondition('原数据库资源不能转归其他项目');
      });
      return work(guard);
    });
  };
  const native: NativePostgresWork = { run: (origin, names, effect) => withResource(origin, async (guard) => {
    if (!names.length || names.some((name) => !/^cs_[a-z0-9_]{1,60}$/.test(name))) throw precondition('原生数据库名字锁不合法');
    const process = await input.processes?.protectCurrent(), workId = newResourceId();
    if (process && (!process.podUid || !process.containerId || !process.nodeUid || !process.nodeName)) throw precondition('原数据库写入容器来源不完整');
    const [backend] = await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
    await db.transaction((tx) => tx.execute(sql`INSERT INTO data_control.deletion_work(work_id,resource_id,project_id,backend_pid,names,pod_uid,container_id,node_uid,node_name)
      VALUES (${workId},${origin.resourceId},${origin.projectId},${backend!.pid},${JSON.stringify([...new Set(names)].sort())}::jsonb,${process?.podUid ?? null},${process?.containerId ?? null},${process?.nodeUid ?? null},${process?.nodeName ?? null})`));
    try {
      // The native scope is INSIDE the actual callback. A rejected main transaction cannot release it early.
      return await withNativePostgresNames(input.adminUrl, names, async (connection) => {
        const admitted = async () => { assertSharedDatabaseAdmissionActive(db, nativeAdmissionKey(origin.projectId)); await open(guard, origin.projectId, input.available); };
        await admitted();
        const [binding] = await connection.query<{ pid: number; started: string; identifier: string }[]>("SELECT pg_backend_pid() AS pid,(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS started,(SELECT system_identifier::text FROM pg_control_system()) AS identifier");
        if (!binding?.started || !binding.identifier) throw precondition('原生数据库写入来源不完整');
        const endpoint = new URL(input.adminUrl); endpoint.username = ''; endpoint.password = ''; endpoint.pathname = '/postgres';
        await db.transaction((tx) => tx.execute(sql`UPDATE data_control.deletion_work SET native_pid=${binding.pid},native_started=${binding.started},source_identity=${jsonHash({ endpoint: endpoint.toString(), identifier: binding.identifier })} WHERE work_id=${workId} AND state='running'`));
        const checked: NativeDdlConnection = { assertHeld: async () => { await admitted(); await connection.assertHeld(); }, query: async (text, parameters) => {
          await admitted(); await connection.assertHeld(); return connection.query(text, parameters);
        } };
        return effect(checked);
      });
    } finally {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('crewstation.data_control_work_exit',${workId},true)`);
        await tx.execute(sql`UPDATE data_control.deletion_work SET state='finished' WHERE work_id=${workId} AND state='running'`);
      });
    }
  }) };
  const recover = (process: NativePostgresProcess, digest: string) => db.transaction(async (tx) => {
    if (!process.podUid || !process.containerId || !process.nodeUid || !process.nodeName || !/^[a-f0-9]{64}$/.test(digest)) throw precondition('原数据库写入容器停止证明不完整');
    const rows = await tx.execute<{ work_id: string }>(sql`SELECT work_id FROM data_control.deletion_work WHERE state='running' AND pod_uid=${process.podUid} AND container_id=${process.containerId} AND node_uid=${process.nodeUid} AND node_name=${process.nodeName} ORDER BY work_id FOR UPDATE`);
    for (const row of rows) {
      await tx.execute(sql`SELECT set_config('crewstation.data_control_work_exit',${row.work_id},true)`);
      await tx.execute(sql`UPDATE data_control.deletion_work SET state='finished',proof_digest=${digest} WHERE work_id=${row.work_id}`);
    }
  });
  const originOf = async (id: string): Promise<NativePostgresOrigin | undefined> => {
    const [row] = await db.execute<{ project_id: ProjectId }>(sql`SELECT project_id FROM data_control.deletion_entities WHERE resource_id=${id}`);
    return row ? { projectId: row.project_id, resourceId: id } : undefined;
  };
  return { native, withResource, recover, originOf, sweep: () => input.processes?.sweep({ stopped: recover, releasable: async (uid) => {
    const [row] = await db.execute<{ pending: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM data_control.deletion_work WHERE pod_uid=${uid} AND state='running') AS pending`);
    return row?.pending === false;
  } }) ?? Promise.resolve() };
}
