import { sql } from 'drizzle-orm';
import { precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { objectStorageTransaction } from '../objectCatalog';

import { STORAGE_CONTRACT_VERSION, readStorageContract, assertStorageContractEnabled } from './contractState';

export function storageContractRepository(db: Database) {
  return {
    version: STORAGE_CONTRACT_VERSION,
    check: async (supportedVersion = STORAGE_CONTRACT_VERSION) => {
      const state = await readStorageContract(db);
      if (state.requiredVersion > supportedVersion) throw precondition('当前程序不支持已启用的对象存储合同；禁止启动或回退', { code: 'storage_contract_incompatible', requiredVersion: state.requiredVersion, supportedVersion });
      return state;
    },
    enable: () => objectStorageTransaction(db, async (tx) => {
      const previous = await readStorageContract(tx);
      if (previous.requiredVersion > STORAGE_CONTRACT_VERSION) throw precondition('对象存储合同版本高于当前程序');
      await tx.execute(sql`UPDATE data.storage_contract SET required_version=${STORAGE_CONTRACT_VERSION},enabled=true,enabled_at=coalesce(enabled_at,clock_timestamp()) WHERE id='service-object-storage'`);
      await assertStorageContractEnabled(tx);
    }),
  };
}
