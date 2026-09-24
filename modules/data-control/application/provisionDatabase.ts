import type { Logger } from '@crewstation/kernel';
import type { DataPlaneSnapshot } from '../domain/dataPlane';
import { databaseToProvision, temporaryRoleToProvision } from '../domain/provisioning';
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
 * 建库与临时角色（RFC-025 I28 裁定：data-control 生成口令）：先把口令加密存下（按记录 ID，已存的就用存的——重试时角色的口令与存下的一致），
 * 再建运行角色与库（或访问绑定的临时角色），当场补一次观测（不等下一轮全量，data 正等它就绪）。返回之后的快照（没建就原样返回）。
 */
export async function provisionDatabase(deps: ProvisionDeps, snapshot: DataPlaneSnapshot, record: DataRecordView): Promise<DataPlaneSnapshot> {
  const database = databaseToProvision(record, snapshot), temporary = database ? undefined : temporaryRoleToProvision(record, snapshot);
  const role = database?.role ?? temporary?.role;
  if (!role) return snapshot;
  const stored = await deps.store.get(record.id) ?? await deps.store.putIfAbsent({ resourceId: record.id, role, secretBox: await deps.cipher.encrypt(newPassword()) });
  const password = await deps.cipher.decrypt(stored.secretBox);
  // 临时角色（第二步）同一套：口令先存再建，到期时间由数据库自己执行。
  if (database) await deps.plane.ensureDatabase({ ...database, password });
  else await deps.plane.ensureTemporaryRole({ ...temporary!, password });
  deps.stats.provisioned += 1;
  deps.logger.info('data role provisioned', { resourceId: record.id, role, ...(database ? { database: database.database } : { temporary: true }) });
  const fresh = await deps.plane.snapshot();
  await observeDataRecord(deps.ledger, fresh, deps.stats, record);
  return fresh;
}

/** 解密后的口令：data 渲染容器的连接串时经端口要（I28）；没存过返回 undefined。 */
export async function credentialOf(deps: Pick<ProvisionDeps, 'store' | 'cipher'>, resourceId: string): Promise<{ role: string; password: string } | undefined> {
  const stored = await deps.store.get(resourceId);
  return stored ? { role: stored.role, password: await deps.cipher.decrypt(stored.secretBox) } : undefined;
}
