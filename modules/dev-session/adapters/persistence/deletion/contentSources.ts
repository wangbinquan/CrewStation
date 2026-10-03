import { ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import type { ProjectId } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DevelopmentContentOrigin, DevelopmentDeletionOrigin } from '../../../domain/deletion/content';
import type { DevelopmentDeletionSources } from '../../../ports/deletion/sources';

const originSchema = z.strictObject({ complete: z.literal(true), id: ResourceIdSchema, scope: z.enum(['project', 'platform']),
  projectIds: z.array(ProjectIdSchema), revision: z.string().regex(/^[a-f0-9]{64}$/) }).superRefine((value, context) => {
  if (new Set(value.projectIds).size !== value.projectIds.length || value.projectIds.length !== (value.scope === 'project' ? 1 : 0))
    context.addIssue({ code: 'custom', message: '开发内容的原归属不完整或共享' });
});
const representation = (key: string) => ResourceIdSchema.safeParse(key).success ? 'current' as const : 'legacy' as const;
type Kind = DevelopmentContentOrigin['kind'];
interface Accepted extends Record<string, unknown> { owner: string; workspace: string; id: string; agent: string; embedded: string | null }

/** A reserved child is scoped by its actual accepted parent, never by a caller supplied project hint. */
export class DevelopmentContentSources {
  private readonly publicCache = new Map<string, Promise<DevelopmentDeletionOrigin | undefined>>();
  private readonly acceptedCache = new Map<string, Promise<DevelopmentDeletionOrigin | undefined>>();
  private readonly origins = new Map<string, DevelopmentContentOrigin>();
  constructor(private readonly db: Executor, private readonly sources: DevelopmentDeletionSources, private readonly project: ProjectId) {}

  private remember(kind: Kind, key: string, origin: DevelopmentDeletionOrigin) {
    if (origin.projectIds[0] === this.project) this.origins.set(JSON.stringify([kind, key]), { kind, key, id: origin.id, projectId: this.project,
      identity: jsonHash({ kind, key, id: origin.id, projectId: this.project }) });
    return origin;
  }
  private publicSource(kind: Kind, key: string) {
    const cacheKey = JSON.stringify([kind, key]); let found = this.publicCache.get(cacheKey);
    if (!found) {
      found = (async () => {
        const mode = representation(key), value = await this.sources.resolve(kind, key, mode);
        if (value === undefined) return undefined;
        const origin = originSchema.parse(value);
        if (mode === 'current' && origin.id !== key) throw precondition('开发内容与原对象 ID 不符');
        return this.remember(kind, key, origin);
      })();
      this.publicCache.set(cacheKey, found);
    }
    return found;
  }
  private acceptedTask(key: string) {
    let found = this.acceptedCache.get(key);
    if (!found) {
      found = (async () => {
        const alias = await this.db.execute<{ id: string }>(sql`SELECT id FROM dev_session.resource_identity_aliases WHERE kind='task' AND key=${JSON.stringify([key])}`);
        const id = alias[0]?.id ?? key;
        const rows = await this.db.execute<Accepted>(sql`SELECT 'agent' AS owner,task_id AS workspace,execution_task_id AS id,agent_id AS agent,execution->>'taskId' AS embedded
          FROM dev_session.agent_starts WHERE execution_task_id=${id}
          UNION ALL SELECT 'native',task_id,execution_task_id,agent_id,execution->>'taskId' FROM dev_session.native_terminal_starts WHERE execution_task_id=${id}`);
        if (!rows.length) return undefined;
        const row = rows[0]!;
        if (rows.length !== 1 || row.id !== row.embedded || row.workspace === row.id || representation(key) === 'current' && id !== key)
          throw precondition('开发原受理子任务存在冲突');
        ResourceIdSchema.parse(row.id); ResourceIdSchema.parse(row.agent);
        const parent = await this.publicSource('task', row.workspace);
        if (!parent || parent.scope !== 'project') throw precondition('开发受理缺少实际原父工作区，不能递归猜测归属');
        const origin: DevelopmentDeletionOrigin = { complete: true, id: row.id, scope: 'project', projectIds: parent.projectIds,
          revision: jsonHash({ owner: row.owner, workspace: row.workspace, id: row.id, agent: row.agent, parent }) };
        this.remember('task', row.id, origin); return this.remember('task', key, origin);
      })();
      this.acceptedCache.set(key, found);
    }
    return found;
  }
  async resolve(kind: Kind, key: string): Promise<DevelopmentDeletionOrigin> {
    const origin = await this.publicSource(kind, key) ?? (kind === 'task' ? await this.acceptedTask(key) : undefined);
    if (!origin) throw precondition('开发内容的原任务或管理操作来源缺失');
    return origin;
  }
  async reservedTask(key: string, operation: DevelopmentDeletionOrigin): Promise<DevelopmentDeletionOrigin> {
    ResourceIdSchema.parse(key);
    const origin = await this.publicSource('task', key) ?? await this.acceptedTask(key);
    if (origin) return origin;
    if (operation.scope !== 'project') throw precondition('平台管理操作不能认领项目开发内容');
    return this.remember('task', key, { complete: true, id: key, scope: 'project', projectIds: operation.projectIds,
      revision: jsonHash({ id: key, operation }) });
  }
  async legacyAgent(key: string | null, expected: string) {
    ResourceIdSchema.parse(expected);
    if (key === null) return;
    const alias = await this.db.execute<{ id: string }>(sql`SELECT id FROM dev_session.resource_identity_aliases WHERE kind='agent' AND key=${JSON.stringify([key])}`);
    const id = alias[0]?.id ?? (ResourceIdSchema.safeParse(key).success ? key : undefined);
    if (id !== expected) throw precondition('开发当前内容和历史记录不属于同一原 Agent');
  }
  listOrigins() {
    return [...this.origins.values()].sort((a, b) => Buffer.compare(Buffer.from(JSON.stringify([a.kind, a.key])), Buffer.from(JSON.stringify([b.kind, b.key]))));
  }
}
