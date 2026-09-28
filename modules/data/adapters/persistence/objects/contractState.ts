import { sql } from 'drizzle-orm';
import { precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';

export const STORAGE_CONTRACT_VERSION = 1;
export async function readStorageContract(db: Executor): Promise<{ requiredVersion: number; enabled: boolean }> {
  const [table] = await db.execute<{ present: boolean; spaces: boolean }>(sql`SELECT to_regclass('data.storage_contract') IS NOT NULL AS present,to_regclass('data.object_spaces') IS NOT NULL AS spaces`);
  if (!table?.present) {
    if (table?.spaces) throw precondition('对象元数据存在但合同版本缺失', { code: 'storage_contract_unknown' });
    return { requiredVersion: 0, enabled: false };
  }
  const [row] = await db.execute<{ requiredVersion: number; enabled: boolean }>(sql`SELECT required_version AS "requiredVersion", enabled FROM data.storage_contract WHERE id='service-object-storage'`);
  if (!row) throw precondition('对象存储合同版本记录缺失', { code: 'storage_contract_unknown' });
  return row;
}
export async function assertStorageContractEnabled(tx: Executor): Promise<void> {
  const state = await readStorageContract(tx);
  if (!state.enabled || state.requiredVersion !== STORAGE_CONTRACT_VERSION) throw precondition('对象存储兼容版本尚未启用', { code: 'storage_contract_unavailable' });
}
