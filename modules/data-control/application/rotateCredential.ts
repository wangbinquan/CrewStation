import { conflict } from '@crewstation/kernel';
import type { CredentialStore, SecretCipher } from '../ports/credentials';
import type { DataPlaneWriter } from '../ports/dataPlane';
import type { DataLedgerObservations } from '../ports/ledger';
import { newPassword } from './provisionDatabase';

/** 与资源台账的 CredentialRotating 条件在同一个事务提交；重试保留已经生成的待生效口令。 */
export async function stageCredentialRotation(deps: { ledger: DataLedgerObservations; store: CredentialStore; cipher: SecretCipher }, id: string): Promise<void> {
  const record = await deps.ledger.get(id);
  const role = record?.spec.children.find((child) => child.kind === 'PostgresRole')?.name;
  if (record?.kind !== 'database' || record.desired !== 'present' || !role) throw conflict('只能轮换仍保留的数据库运行角色');
  await deps.store.stageRotation(id, role, await deps.cipher.encrypt(newPassword()));
}

/** 先 ALTER，再提交有效口令和清除标记；任何一步失败，已提交的 pendingBox 都能用于重试。 */
export async function finishCredentialRotation(deps: { ledger: DataLedgerObservations; store: CredentialStore; cipher: SecretCipher; plane: DataPlaneWriter }, id: string): Promise<void> {
  const stored = await deps.store.get(id);
  if (!stored?.pendingBox) return;
  const record = await deps.ledger.get(id);
  await deps.plane.rotatePassword({ role: stored.role, password: await deps.cipher.decrypt(stored.pendingBox), ...(record?.projectId ? { origin: { projectId: record.projectId, resourceId: id } } : {}) });
  await deps.store.finishRotation(id, stored.pendingBox);
}
