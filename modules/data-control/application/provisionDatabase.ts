import type { Logger } from '@crewstation/kernel';
import type { DataPlaneSnapshot } from '../domain/dataPlane';
import { databaseToProvision } from '../domain/provisioning';
import type { CredentialStore, SecretCipher } from '../ports/credentials';
import type { DataPlaneReader, DataPlaneWriter } from '../ports/dataPlane';
import type { DataLedgerObservations, DataRecordView } from '../ports/ledger';
import type { DataObservationStats } from './observeDataPlane';
import { observeDataRecord } from './observeDataPlane';

export interface ProvisionDeps {
  readonly ledger: DataLedgerObservations;
  readonly plane: DataPlaneReader & DataPlaneWriter;
  readonly store: CredentialStore;
  readonly cipher: SecretCipher;
  readonly stats: DataObservationStats;
  readonly logger: Logger;
}

/** 平台生成的角色口令：24 字节随机数的 base64url（数据面只收这种字符）。 */
export function newPassword(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
}

/**
 * 建库（RFC-025 I28 裁定：data-control 生成口令）：先把口令加密存下（按记录 ID，已存的就用存的——重试时角色的口令与存下的一致），
 * 再建运行角色与库，当场补一次观测（不等下一轮全量，data 正等它就绪）。返回之后的快照（没建就原样返回）。
 */
export async function provisionDatabase(deps: ProvisionDeps, snapshot: DataPlaneSnapshot, record: DataRecordView): Promise<DataPlaneSnapshot> {
  const target = databaseToProvision(record, snapshot);
  if (!target) return snapshot;
  const stored = await deps.store.get(record.id) ?? await deps.store.putIfAbsent({ resourceId: record.id, role: target.role, secretBox: await deps.cipher.encrypt(newPassword()) });
  await deps.plane.ensureDatabase({ ...target, password: await deps.cipher.decrypt(stored.secretBox) });
  deps.stats.provisioned += 1;
  deps.logger.info('data database provisioned', { resourceId: record.id, database: target.database });
  const fresh = await deps.plane.snapshot();
  await observeDataRecord(deps.ledger, fresh, deps.stats, record);
  return fresh;
}

/** 解密后的口令：data 渲染容器的连接串时经端口要（I28）；没存过返回 undefined。 */
export async function credentialOf(deps: Pick<ProvisionDeps, 'store' | 'cipher'>, resourceId: string): Promise<{ role: string; password: string } | undefined> {
  const stored = await deps.store.get(resourceId);
  return stored ? { role: stored.role, password: await deps.cipher.decrypt(stored.secretBox) } : undefined;
}
