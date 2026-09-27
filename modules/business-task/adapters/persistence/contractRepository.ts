import type { AgentProfile, OutputContract, ReleaseId, ServiceId } from '@crewstation/contracts';
import { conflict, jsonHash } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { ContractRegistration } from '../../domain/contractRegistry';
import type { ContractRepository } from '../../ports/repositories';
import { contracts } from './tables';

const json = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
function toContract(row: typeof contracts.$inferSelect): ContractRegistration {
  return { serviceId: row.serviceId as ServiceId, releaseId: row.releaseId as ReleaseId, tag: row.tag,
    ...(row.releaseMaterials ? { releaseMaterials: row.releaseMaterials } : {}),
    agentProfiles: json<AgentProfile[]>(row.agentProfiles), outputContracts: json<OutputContract[]>(row.outputContracts),
    ...(row.tasksSpec ? { tasksSpec: json<NonNullable<ContractRegistration['tasksSpec']>>(row.tasksSpec) } : {}), registeredAt: row.registeredAt };
}
function baseDigest(c: ContractRegistration): string {
  return jsonHash({ serviceId: c.serviceId, releaseId: c.releaseId, tag: c.tag, agentProfiles: c.agentProfiles, outputContracts: c.outputContracts });
}

export function drizzleContractRepository(db: Executor): ContractRepository {
  return {
    save: async (c) => {
      const values = { releaseMaterials: c.releaseMaterials ?? null, releaseId: c.releaseId, serviceId: c.serviceId, tag: c.tag, agentProfiles: c.agentProfiles as unknown, outputContracts: c.outputContracts as unknown, tasksSpec: c.tasksSpec ?? null, registeredAt: c.registeredAt };
      const inserted = await db.insert(contracts).values(values).onConflictDoNothing().returning({ id: contracts.releaseId });
      if (inserted.length) return;
      const row = (await db.select().from(contracts).where(eq(contracts.releaseId, c.releaseId)))[0]!;
      const old = toContract(row);
      if (baseDigest(old) !== baseDigest(c)) throw conflict('发布契约已登记，不能替换内容', { code: 'release_contract_conflict' });
      if (jsonHash(old.releaseMaterials ?? {}) !== jsonHash(c.releaseMaterials ?? {})) throw conflict('发布执行文件已固定', { code: 'release_contract_conflict' });
      if (old.tasksSpec && c.tasksSpec && jsonHash(old.tasksSpec) !== jsonHash(c.tasksSpec)) throw conflict('发布任务契约已固定', { code: 'release_contract_conflict' });
      if (!old.tasksSpec && c.tasksSpec) {
        // 旧平台登记的行可以从同一 release 的原始事件补齐；不改首次登记顺序，不覆盖并发补齐。
        const upgraded = await db.update(contracts).set({ tasksSpec: c.tasksSpec }).where(and(eq(contracts.releaseId, c.releaseId), isNull(contracts.tasksSpec))).returning({ id: contracts.releaseId });
        if (!upgraded.length) {
          const current = (await db.select().from(contracts).where(eq(contracts.releaseId, c.releaseId)))[0]!;
          if (jsonHash(current.tasksSpec) !== jsonHash(c.tasksSpec)) throw conflict('发布任务契约已固定', { code: 'release_contract_conflict' });
        }
      }
    },
    forRelease: async (serviceId, releaseId) => {
      const row = (await db.select().from(contracts).where(and(eq(contracts.serviceId, serviceId), eq(contracts.releaseId, releaseId))))[0];
      return row ? toContract(row) : undefined;
    },
    latest: async (serviceId) => {
      const row = (await db.select().from(contracts).where(eq(contracts.serviceId, serviceId)).orderBy(desc(contracts.registeredAt)).limit(1))[0];
      return row ? toContract(row) : undefined;
    },
  };
}
