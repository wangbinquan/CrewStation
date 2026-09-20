import type { ConfigEnv, ProjectId, UserId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, eq, sql } from 'drizzle-orm';
import type { ConfigItem } from '../../domain/configItem';
import type { ConfigVersion, ConfigVersionEntry } from '../../domain/configVersion';
import type { ConfigDefinitionRepository, ConfigItemRepository, ConfigVersionRepository } from '../../ports/repositories';
import { definitions, items, valueSets, versionEntries, versions } from './tables';

export function drizzleConfigItemRepository(db: Executor): ConfigItemRepository {
  const inSet = (projectId: ProjectId, env: ConfigEnv) => and(eq(items.projectId, projectId), eq(items.env, env));
  return {
    list: async (projectId, env) => (await db.select().from(items).where(inSet(projectId, env)).orderBy(items.name)).map(toItem),
    get: async (projectId, env, id) => {
      const row = (await db.select().from(items).where(and(inSet(projectId, env), eq(items.id, id))))[0];
      return row ? toItem(row) : undefined;
    },
    upsert: async (item) => {
      const { id, ...rest } = item;
      await db.insert(items).values({ id, ...rest })
        .onConflictDoUpdate({ target: items.id, set: { ...rest } });
    },
    remove: async (projectId, env, id) => {
      await db.delete(items).where(and(inSet(projectId, env), eq(items.id, id)));
    },
  };
}

export function drizzleConfigVersionRepository(db: Executor): ConfigVersionRepository {
  const inSet = (projectId: ProjectId, env: ConfigEnv) => and(eq(versions.projectId, projectId), eq(versions.env, env));
  return {
    next: async (projectId, env, now) => {
      const rows = await db.insert(valueSets).values({ projectId, env, currentVersion: 1, updatedAt: now })
        .onConflictDoUpdate({ target: [valueSets.projectId, valueSets.env], set: { currentVersion: sql`${valueSets.currentVersion} + 1`, updatedAt: now } })
        .returning({ version: valueSets.currentVersion });
      const version = rows[0]?.version;
      if (version === undefined) throw new Error('配置版本计数器未返回新版本号');
      return version;
    },
    current: async (projectId, env) => {
      const row = (await db.select({ version: valueSets.currentVersion }).from(valueSets).where(and(eq(valueSets.projectId, projectId), eq(valueSets.env, env))))[0];
      return row?.version ?? 0;
    },
    insert: async (snapshot) => {
      const { projectId, env, version, createdBy, createdAt } = snapshot;
      await db.insert(versions).values({ projectId, env, version, createdBy, createdAt });
      if (snapshot.entries.length > 0) {
        await db.insert(versionEntries).values(snapshot.entries.map((e) => ({ projectId, env, version, itemId: e.itemId, definitionId: e.definitionId, bindingName: e.bindingName, name: e.name, isSecret: e.isSecret, value: e.value })));
      }
    },
    get: async (projectId, env, version) => {
      const row = (await db.select().from(versions).where(and(inSet(projectId, env), eq(versions.version, version))))[0];
      if (!row) return undefined;
      const entries = await db.select().from(versionEntries).where(and(eq(versionEntries.projectId, projectId), eq(versionEntries.env, env), eq(versionEntries.version, version))).orderBy(versionEntries.name);
      return toVersion(row, entries.map(toEntry));
    },
    list: async (projectId, env) => {
      const rows = await db.select().from(versions).where(inSet(projectId, env)).orderBy(versions.version);
      const entries = await db.select().from(versionEntries).where(and(eq(versionEntries.projectId, projectId), eq(versionEntries.env, env))).orderBy(versionEntries.name);
      return rows.map((row) => toVersion(row, entries.filter((e) => e.version === row.version).map(toEntry)));
    },
  };
}

function toItem(row: typeof items.$inferSelect): ConfigItem {
  return { id: row.id, definitionId: row.definitionId, bindingName: row.bindingName, projectId: row.projectId as ProjectId, env: row.env as ConfigEnv, name: row.name, isSecret: row.isSecret, value: row.value, version: row.version, updatedBy: row.updatedBy as UserId, updatedAt: row.updatedAt };
}

function toEntry(row: typeof versionEntries.$inferSelect): ConfigVersionEntry {
  return { itemId: row.itemId, definitionId: row.definitionId, bindingName: row.bindingName, name: row.name, isSecret: row.isSecret, value: row.value };
}

function toVersion(row: typeof versions.$inferSelect, entries: ConfigVersionEntry[]): ConfigVersion {
  return { projectId: row.projectId as ProjectId, env: row.env as ConfigEnv, version: row.version, entries, createdBy: row.createdBy as UserId, createdAt: row.createdAt };
}

export function drizzleConfigDefinitionRepository(db: Executor): ConfigDefinitionRepository {
  return {
    list: async (projectId) => db.select().from(definitions).where(eq(definitions.projectId, projectId)).orderBy(definitions.name, definitions.id),
    get: async (projectId, id) => (await db.select().from(definitions).where(and(eq(definitions.projectId, projectId), eq(definitions.id, id))))[0],
    insert: async (definition) => { await db.insert(definitions).values(definition); },
    insertIfAbsent: async (definition) => { await db.insert(definitions).values(definition).onConflictDoNothing(); },
    rename: async (projectId, id, name) => {
      await db.update(definitions).set({ name }).where(and(eq(definitions.projectId, projectId), eq(definitions.id, id)));
      await db.update(items).set({ name }).where(and(eq(items.projectId, projectId), eq(items.definitionId, id)));
    },
  };
}
