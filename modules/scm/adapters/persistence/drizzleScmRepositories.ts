import type { ProjectId, ServiceId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, eq, isNull, lte } from 'drizzle-orm';
import type { RepositoryBinding, RepositoryBindingState } from '../../domain/repositoryBinding';
import type { SessionCredential } from '../../domain/sessionCredential';
import type { RepositoryBindingRepository, SessionCredentialRepository } from '../../ports/repositories';
import { repositoryBindings, sessionCredentials } from './tables';

export function drizzleRepositoryBindingRepository(db: Executor): RepositoryBindingRepository {
  const first = (rows: Array<typeof repositoryBindings.$inferSelect>): RepositoryBinding | undefined => (rows[0] ? toBinding(rows[0]) : undefined);
  return {
    getByServiceId: (serviceId) => db.select().from(repositoryBindings).where(eq(repositoryBindings.serviceId, serviceId)).then(first),
    getByPath: (path) => db.select().from(repositoryBindings).where(eq(repositoryBindings.pathWithNamespace, path)).then(first),
    upsert: async (binding) => {
      const { serviceId: _key, ...changes } = toBindingRow(binding);
      await db.insert(repositoryBindings).values(toBindingRow(binding)).onConflictDoUpdate({ target: repositoryBindings.serviceId, set: changes });
    },
  };
}

export function drizzleSessionCredentialRepository(db: Executor): SessionCredentialRepository {
  return {
    insert: async (credential) => { await db.insert(sessionCredentials).values({ ...credential, revokedAt: credential.revokedAt ?? null }); },
    getById: async (id) => {
      const row = (await db.select().from(sessionCredentials).where(eq(sessionCredentials.id, id)))[0];
      return row ? toCredential(row) : undefined;
    },
    listExpired: async (now) => (await db.select().from(sessionCredentials)
      .where(and(isNull(sessionCredentials.revokedAt), lte(sessionCredentials.expiresAt, now))).orderBy(sessionCredentials.expiresAt)).map(toCredential),
    markRevoked: async (id, at) => { await db.update(sessionCredentials).set({ revokedAt: at }).where(eq(sessionCredentials.id, id)); },
  };
}

function toBinding(row: typeof repositoryBindings.$inferSelect): RepositoryBinding {
  return {
    serviceId: row.serviceId as ServiceId, projectId: row.projectId as ProjectId, provider: 'gitlab', remoteProjectId: row.remoteProjectId,
    pathWithNamespace: row.pathWithNamespace, httpUrl: row.httpUrl, ...(row.webUrl ? { webUrl: row.webUrl } : {}), defaultBranch: row.defaultBranch, state: row.state as RepositoryBindingState,
    ...(row.message ? { message: row.message } : {}), createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function toBindingRow(binding: RepositoryBinding): typeof repositoryBindings.$inferInsert {
  return { ...binding, webUrl: binding.webUrl ?? null, message: binding.message ?? null };
}

function toCredential(row: typeof sessionCredentials.$inferSelect): SessionCredential {
  return {
    id: row.id, serviceId: row.serviceId as ServiceId, remoteTokenId: row.remoteTokenId, tokenHash: row.tokenHash,
    expiresAt: row.expiresAt, createdAt: row.createdAt, ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
  };
}
