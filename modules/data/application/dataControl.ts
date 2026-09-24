import type { DataUseCaseDeps } from './dependencies';

/**
 * 等 data-control 建好（RFC-025 I28）：记录就绪（数据面上的对象都观测到了）且口令已存下。过了时限返回 false——期望留着，
 * 调和器会接着建。返回最后读到的阶段，调用方写进日志。
 */
export async function awaitProvisioned(deps: DataUseCaseDeps, recordId: string): Promise<{ readonly ready: boolean; readonly phase?: string }> {
  const provisioning = deps.provisioning!, deadline = Date.now() + (provisioning.waitMs ?? 60_000);
  for (;;) {
    const record = await provisioning.ledger.get(recordId);
    if (record?.phase === 'ready' && await provisioning.credentials.credentialOf(recordId)) return { ready: true };
    if (Date.now() >= deadline) return { ready: false, ...(record?.phase ? { phase: record.phase } : {}) };
    await Bun.sleep(provisioning.pollMs ?? 500);
  }
}

/** data-control 存着口令的角色的连接串：向它要口令，用容器看得到的主机与端口拼；没存过返回 undefined。值不落 data 的库。 */
export async function dataControlDsn(deps: DataUseCaseDeps, recordId: string, database: string): Promise<string | undefined> {
  const credential = deps.provisioning ? await deps.provisioning.credentials.credentialOf(recordId) : undefined;
  return credential ? deps.provisioning!.dsnOf(credential.role, credential.password, database) : undefined;
}
