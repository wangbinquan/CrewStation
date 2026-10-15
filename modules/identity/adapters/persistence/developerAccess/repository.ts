import type { Database, Executor } from '@crewstation/persistence';
import { keyedLock } from '@crewstation/persistence';
import { and, desc, eq, lt } from 'drizzle-orm';
import { DeveloperAccessRequestDtoSchema } from '@crewstation/contracts';
import { conflict } from '@crewstation/kernel';
import type { DeveloperAccessRepository, DeveloperAccessScope, DeveloperAccessUnitOfWork } from '../../../ports/access/developerAccess';
import { drizzleUserRepository } from '../drizzleUserRepository';
import { users } from '../tables';
import { developerAccessRequests as requests } from './table';

function repository(db: Executor): DeveloperAccessRepository {
  const rows = () => db.select({ request: requests, userName: users.name, userEmail: users.email }).from(requests).innerJoin(users, eq(requests.userId, users.id));
  const dto = (row: { request: typeof requests.$inferSelect; userName: string; userEmail: string }) => DeveloperAccessRequestDtoSchema.parse({ ...row.request, userName: row.userName, userEmail: row.userEmail, createdAt: row.request.createdAt.toISOString(), reviewedAt: row.request.reviewedAt?.toISOString() ?? null });
  return {
    get: async id => { const row = (await rows().where(eq(requests.id, id)).limit(1))[0]; return row ? dto(row) : undefined; },
    latest: async userId => { const row = (await rows().where(eq(requests.userId, userId)).orderBy(desc(requests.id)).limit(1))[0]; return row ? dto(row) : undefined; },
    list: async query => {
      const found = await rows().where(and(eq(requests.state, query.state), query.cursor ? lt(requests.id, query.cursor) : undefined)).orderBy(desc(requests.id)).limit(query.limit + 1);
      const items = found.slice(0, query.limit).map(dto);
      return { items, ...(found.length > query.limit ? { nextCursor: items.at(-1)!.id } : {}) };
    },
    insert: async item => { const { userName: _name, userEmail: _email, ...row } = item; await db.insert(requests).values({ ...row, createdAt: new Date(row.createdAt), reviewedAt: row.reviewedAt ? new Date(row.reviewedAt) : null }); },
    update: async (item, revision) => {
      const updated = await db.update(requests).set({ state: item.state, revision: item.revision, reviewerId: item.reviewerId, reviewedAt: item.reviewedAt ? new Date(item.reviewedAt) : null, note: item.note })
        .where(and(eq(requests.id, item.id), eq(requests.revision, revision), eq(requests.state, 'pending'))).returning({ id: requests.id });
      if (!updated.length) throw conflict('申请已处理，请重新读取');
    },
  };
}
export function developerAccessUnitOfWork(db: Database): DeveloperAccessUnitOfWork {
  const scope = (executor: Executor): DeveloperAccessScope => ({ users: drizzleUserRepository(executor), requests: repository(executor) });
  return { read: scope(db), run: (id, work) => keyedLock(db)(['platform-roles', `user-role:${id}`], () => db.transaction(tx => work(scope(tx)))) };
}
