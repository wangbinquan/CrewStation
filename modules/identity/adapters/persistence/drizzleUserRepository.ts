import type { UserId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, count, eq, sql } from 'drizzle-orm';
import type { User } from '../../domain/user';
import type { UserRepository } from '../../ports/userRepository';
import { users } from './tables';

export function drizzleUserRepository(db: Executor): UserRepository {
  const one = async (rows: Array<typeof users.$inferSelect>): Promise<User | undefined> => {
    const row = rows[0];
    return row ? toUser(row) : undefined;
  };
  return {
    getById: (id) => db.select().from(users).where(eq(users.id, id)).then(one),
    getByExternalId: (externalId) => db.select().from(users).where(eq(users.externalId, externalId)).then(one),
    getByUsername: (username) => db.select().from(users).where(eq(users.username, username)).then(one),
    getByEmail: (email) => db.select().from(users).where(sql`lower(${users.email}) = lower(${email})`).limit(2).then((rows) => rows.length === 1 ? one(rows) : undefined),
    count: async () => Number((await db.select({ n: count() }).from(users))[0]?.n ?? 0),
    countAdmins: async () => Number((await db.select({ n: count() }).from(users).where(eq(users.platformRole, 'admin')))[0]?.n ?? 0),
    setPlatformRole: async (id, platformRole) => { await db.update(users).set({ platformRole, roleInitialized: true }).where(eq(users.id, id)); },
    uninitializedRoles: async (limit) => (await db.select().from(users).where(eq(users.roleInitialized, false)).orderBy(users.id).limit(limit)).map(toUser),
    initializeRole: async (id, platformRole) => (await db.update(users).set({ platformRole, roleInitialized: true }).where(and(eq(users.id, id), eq(users.roleInitialized, false))).returning({ id: users.id })).length === 1,
    list: async () => (await db.select().from(users).orderBy(users.createdAt)).map(toUser),
    insert: async (user) => { await db.insert(users).values(toRow(user)); },
    update: async (user) => {
      // Profile refreshes never overwrite an administrator's concurrent role change.
      const { platformRole: _role, ...profile } = toRow(user);
      await db.update(users).set(profile).where(eq(users.id, user.id));
    },
  };
}

function toUser(row: typeof users.$inferSelect): User {
  return { id: row.id as UserId, externalId: row.externalId, username: row.username, name: row.name, email: row.email, gitName: row.gitName, passwordHash: row.passwordHash, platformRole: row.platformRole, createdAt: row.createdAt, lastLoginAt: row.lastLoginAt };
}

function toRow(user: User): typeof users.$inferInsert {
  return { id: user.id, externalId: user.externalId, username: user.username, name: user.name, email: user.email, gitName: user.gitName, passwordHash: user.passwordHash, platformRole: user.platformRole, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt };
}
