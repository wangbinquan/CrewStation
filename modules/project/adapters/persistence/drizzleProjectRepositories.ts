import type { ManifestKind, MemberRole, ProjectId, ProjectState, ServiceId, UserId } from '@crewstation/contracts';
import { ProjectDeletionOperationSchema, ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import type { Database, Executor } from '@crewstation/persistence';
import { and, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Project } from '../../domain/project';
import type { Service } from '../../domain/service';
import type { MembershipRepository, ProjectRepository, ServiceRepository } from '../../ports/repositories';
import { memberships, projects, services } from './tables';

export function drizzleProjectRepository(db: Executor): ProjectRepository {
  const first = (rows: Array<typeof projects.$inferSelect>): Project | undefined => (rows[0] ? toProject(rows[0]) : undefined);
  return {
    insert: async (project) => { await db.insert(projects).values(toProjectRow(project)); },
    update: async (project) => {
      const rows = await db.update(projects).set(toProjectRow(project)).where(and(eq(projects.id, project.id), ne(projects.state, 'deleting'))).returning({ id: projects.id });
      if (rows.length !== 1) throw precondition('项目正在删除或已不存在，不能恢复原状态');
    },
    getById: (id) => db.select().from(projects).where(eq(projects.id, id)).then(first),
    getBySlug: (slug) => db.select().from(projects).where(eq(projects.slug, slug)).then(first),
    list: async (page) => (await db.select().from(projects).where(page?.after ? gt(projects.id, page.after) : undefined).orderBy(page ? projects.id : projects.createdAt).limit(page ? Math.min(500, Math.max(1, page.limit)) : 2_147_483_647)).map(toProject),
    listByIds: async (ids) => (ids.length === 0 ? [] : (await db.select().from(projects).where(inArray(projects.id, [...ids])).orderBy(projects.createdAt)).map(toProject)),
  };
}

export function drizzleServiceRepository(db: Executor): ServiceRepository {
  const first = (rows: Array<typeof services.$inferSelect>): Service | undefined => (rows[0] ? toService(rows[0]) : undefined);
  return {
    list: async (ids) => ids?.length === 0 ? [] : (await db.select().from(services).where(ids ? inArray(services.projectId, [...ids]) : undefined)).map(toService),
    insert: async (service) => { await db.insert(services).values({ ...service }); },
    getById: (id) => db.select().from(services).where(eq(services.id, id)).then(first),
    getByProject: (projectId) => db.select().from(services).where(eq(services.projectId, projectId)).then(first),
    getByIdentity: (identity) => db.select().from(services).where(eq(services.identity, identity)).then(first),
  };
}

export function drizzleMembershipRepository(db: Executor): MembershipRepository {
  const toMembership = (row: typeof memberships.$inferSelect) => ({ projectId: row.projectId as ProjectId, userId: row.userId as UserId, role: row.role as MemberRole });
  return {
    list: async (projectId) => (await db.select().from(memberships).where(eq(memberships.projectId, projectId)).orderBy(memberships.createdAt)).map(toMembership),
    get: async (projectId, userId) => {
      const row = (await db.select().from(memberships).where(and(eq(memberships.projectId, projectId), eq(memberships.userId, userId))))[0];
      return row ? toMembership(row) : undefined;
    },
    upsert: async (m) => {
      await db.insert(memberships).values({ projectId: m.projectId, userId: m.userId, role: m.role })
        .onConflictDoUpdate({ target: [memberships.projectId, memberships.userId], set: { role: m.role } });
    },
    remove: async (projectId, userId) => {
      await db.delete(memberships).where(and(eq(memberships.projectId, projectId), eq(memberships.userId, userId)));
    },
    listProjectIdsByUser: async (userId) => (await db.select({ projectId: memberships.projectId }).from(memberships).where(eq(memberships.userId, userId))).map((r) => r.projectId as ProjectId),
    listByUser: async (userId) => (await db.select({ member: memberships }).from(memberships).innerJoin(projects, eq(projects.id, memberships.projectId))
      .where(eq(memberships.userId, userId)).orderBy(projects.createdAt, projects.id)).map((row) => toMembership(row.member)),
  };
}

export function toProject(row: typeof projects.$inferSelect): Project {
  return {
    id: row.id as ProjectId, slug: row.slug, name: row.name, kind: row.kind as ManifestKind, namespace: row.namespace,
    ownerUserId: row.ownerUserId as UserId, state: row.state as ProjectState, template: row.template,
    ...(row.initialPlan === null ? {} : { initialPlan: row.initialPlan }),
    ...(row.message ? { message: row.message } : {}), createdBy: row.createdBy as UserId, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function toProjectRow(project: Project): typeof projects.$inferInsert {
  return { ...project, initialPlan: project.initialPlan ?? null, message: project.message ?? null };
}

function toService(row: typeof services.$inferSelect): Service {
  return { id: row.id as ServiceId, projectId: row.projectId as ProjectId, name: row.name, kind: row.kind as ManifestKind, identity: row.identity, createdAt: row.createdAt };
}

/** Reads only original canonical IDs from the retained operation; private plan/body fields never leave this module. */
async function operationProject(executor: Executor, id: string, byProject: boolean) {
  const rows = await executor.execute<{ id: string; project_id: string; body: unknown }>(sql`
    SELECT id,project_id,body FROM project.deletion_operations WHERE ${sql.identifier(byProject ? 'project_id' : 'id')}=${id}`);
  if (!rows.length) return undefined;
  const row = rows[0]!, body = ProjectDeletionOperationSchema.parse(row.body), projectId = ProjectIdSchema.parse(row.project_id);
  if (body.id !== row.id || body.project.id !== projectId || byProject && projectId !== id)
    throw precondition('项目删除最小身份不一致');
  return projectId;
}
async function originalProject(executor: Executor, id: string) {
  const rows = await executor.execute<{ id: string }>(sql`SELECT id FROM project.projects WHERE id=${id}`);
  const retained = await operationProject(executor,id,true);
  return rows.length ? ProjectIdSchema.parse(rows[0]!.id) : retained;
}

/** Service rows must still exist. Missing service history is not reconstructed from names or an old plan. */
export async function projectInfrastructureOwnership(db: Database, kind: 'project'|'service'|'deletion', rawId: string) {
  if (!['project','service','deletion'].includes(kind)) throw precondition('项目归属来源类型未登记');
  const id = ResourceIdSchema.parse(rawId);
  return db.transaction(async (tx) => {
    let projectId: ProjectId | undefined;
    if (kind === 'project') projectId = await originalProject(tx,id);
    else if (kind === 'deletion') projectId = await operationProject(tx,id,false);
    else {
      const rows = await tx.execute<{ project_id: string }>(sql`SELECT project_id FROM project.services WHERE id=${id}`);
      if (rows.length) {
        const parent = ProjectIdSchema.parse(rows[0]!.project_id);
        if (await originalProject(tx,parent) !== parent) throw precondition('服务原项目来源不可读取');
        projectId = parent;
      }
    }
    if (!projectId) return undefined;
    return { complete:true as const,id,scope:'project' as const,projectIds:[projectId],revision:jsonHash({kind,id,projectId}) };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
