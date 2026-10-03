import { ProjectIdSchema, ResourceIdSchema, ServiceIdSchema, TaskKindSchema } from '@crewstation/contracts';
import type { ProjectId } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { RuntimeContentOrigin, RuntimeDeletionOrigin } from '../../../domain/deletion/content';
import type { RuntimeDeletionSources } from '../../../ports/deletion/sources';
import { PROFILE_TEST_PROJECT_ID, PROFILE_TEST_SERVICE_ID } from '../../../domain/profileTestEnvironment';
import { RuntimeContentRows, runtimeObject, runtimeString } from './rowStore';
import type { RuntimeRawRow } from './rowStore';
import { retainedRuntimeOrigin } from './workOrigin';
import type { RuntimeWorkInput } from '../../../domain/deletion/work';

const originSchema = z.strictObject({ complete: z.literal(true), id: ResourceIdSchema, scope: z.enum(['project', 'platform']),
  projectIds: z.array(ProjectIdSchema), revision: z.string().regex(/^[a-f0-9]{64}$/) }).superRefine((origin, context) => {
  if (origin.projectIds.length !== (origin.scope === 'project' ? 1 : 0)) context.addIssue({ code: 'custom', message: '运行环境原来源不完整或共享' });
});
type RootKind = Parameters<RuntimeDeletionSources['resolve']>[0];
export function sameRuntimeScope(facts: readonly RuntimeDeletionOrigin[]): RuntimeDeletionOrigin {
  const first = facts[0];
  if (!first || facts.some((origin) => origin.scope !== first.scope || origin.projectIds[0] !== first.projectIds[0]))
    throw precondition('运行环境原项目或父记录归属冲突');
  return { ...first, revision: jsonHash(facts) };
}

/** Own rows and aliases share one actual snapshot; cross-module roots come exclusively from public original identity ports. */
export class RuntimeContentSources {
  readonly rows: RuntimeContentRows;
  private readonly publicCache = new Map<string, Promise<RuntimeDeletionOrigin | undefined>>();
  private readonly tasks = new Map<string, Promise<RuntimeDeletionOrigin>>();
  private readonly memberCounts = new Map<string, Promise<number>>();
  private readonly origins = new Map<string, RuntimeContentOrigin>();
  constructor(private readonly db: Executor, private readonly sources: RuntimeDeletionSources, private readonly project: ProjectId) {
    this.rows = new RuntimeContentRows(db);
  }
  remember(kind: RuntimeContentOrigin['kind'], key: string, origin: RuntimeDeletionOrigin) {
    if (origin.projectIds[0] === this.project) this.origins.set(JSON.stringify([kind, key]), { kind, key, id: origin.id, projectId: this.project,
      identity: jsonHash({ kind, key, id: origin.id, projectId: this.project }) });
    return origin;
  }
  async aliasId(kind: string, key: string): Promise<string | undefined> {
    const alias = (await this.db.execute<{ id: string }>(sql`SELECT id FROM task_runtime.resource_identity_aliases WHERE kind=${kind} AND key=${JSON.stringify([key])}`))[0]?.id;
    const canonical = ResourceIdSchema.safeParse(key).success ? key : undefined;
    if (alias && canonical && alias !== canonical) throw precondition('运行环境当前原标识目录冲突');
    return alias === undefined ? canonical : ResourceIdSchema.parse(alias);
  }
  publicSource(kind: RootKind, key: string) {
    const cacheKey = JSON.stringify([kind, key]); let pending = this.publicCache.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        const current = ResourceIdSchema.safeParse(key).success;
        const value = await this.sources.resolve(kind, key, current ? 'current' : 'legacy');
        if (value === undefined) return undefined;
        const origin = originSchema.parse(value);
        if (origin.scope !== 'project' || current && origin.id !== key) throw precondition('运行环境公共原来源或当前 ID 不符');
        return this.remember(kind === 'business-task' ? 'task' : kind, key, origin);
      })();
      this.publicCache.set(cacheKey, pending);
    }
    return pending;
  }
  async root(kind: 'project' | 'service', key: string) {
    const origin = await this.publicSource(kind, key);
    if (!origin) throw precondition('运行环境原项目或服务来源缺失');
    if (kind === 'project' && origin.id !== origin.projectIds[0]) throw precondition('运行环境原项目身份冲突');
    return origin;
  }
  async workOrigin(kind: RuntimeWorkInput['originKind'], key: string) {
    const original = await retainedRuntimeOrigin(this.db, kind, key);
    if (!original) throw precondition('运行原回调缺少不可变的最小来源');
    return this.remember(kind, key, original);
  }
  private async taskFromRow(id: string, row: RuntimeRawRow): Promise<RuntimeDeletionOrigin> {
    TaskKindSchema.parse(row['kind']); ResourceIdSchema.parse(id);
    const project = ProjectIdSchema.parse(row['project_id']), service = ServiceIdSchema.parse(row['service_id']);
    let owner: RuntimeDeletionOrigin;
    if (row['kind'] === 'profile-test') {
      if (project !== PROFILE_TEST_PROJECT_ID || service !== PROFILE_TEST_SERVICE_ID || row['native'] !== null)
        throw precondition('运行环境平台测试原范围冲突');
      const render = row['render'] === null ? undefined : runtimeObject(row['render']);
      owner = render && Object.hasOwn(render, 'runtimeValidation')
        ? await this.root('project', ProjectIdSchema.parse(runtimeObject(render['runtimeValidation'])['projectId']))
        : { complete: true, id, scope: 'platform', projectIds: [], revision: jsonHash({ platformTest: true, id }) };
    } else {
      if (row['render'] !== null && Object.hasOwn(runtimeObject(row['render']), 'runtimeValidation')) throw precondition('普通运行环境不能使用平台验证范围');
      owner = sameRuntimeScope([await this.root('project', project), await this.root('service', service)]);
      if (row['native'] !== null) {
        const native = runtimeObject(row['native']), parentKey = runtimeString(native['parentTaskId']), parentId = await this.aliasId('task', parentKey);
        const parent = parentId ? await this.rows.get('environments', parentId) : undefined;
        if (!parent || parentId === id || parent['native'] !== null || parent['service_id'] !== service || parent['kind'] !== row['kind'])
          throw precondition('运行环境原执行缺少实际父工作区或父关系冲突');
        owner = sameRuntimeScope([owner, await this.task(parentKey)]);
        // The native port also accepts protocol identities; project ownership is fixed by the actual original workspace.
        for (const name of ['agentId', 'runnerId', ...(native['terminalId'] === undefined ? [] : ['terminalId'])]) runtimeString(native[name]);
      }
    }
    const original: RuntimeDeletionOrigin = { ...owner, id, revision: jsonHash({ id, kind: row['kind'], project, service, owner,
      ...(row['native'] === null ? {} : { parent: runtimeObject(row['native'])['parentTaskId'] }) }) };
    return this.remember('task', id, original);
  }
  task(key: string): Promise<RuntimeDeletionOrigin> {
    let pending = this.tasks.get(key);
    if (!pending) {
      pending = (async () => {
        const id = await this.aliasId('task', key), row = id ? await this.rows.get('environments', id) : undefined;
        const origin = row ? await this.taskFromRow(id!, row) : await this.publicSource('business-task', key);
        if (!origin) throw precondition('运行环境原任务来源缺失，不能由服务或正文认领未供给任务');
        if (id !== undefined && origin.id !== id) throw precondition('运行环境与受理任务的原标识目录冲突');
        return this.remember('task', key, origin);
      })();
      this.tasks.set(key, pending);
    }
    return pending;
  }
  async legacy(kind: 'task' | 'rebuild' | 'agent' | 'runner' | 'terminal', raw: unknown, expected: unknown) {
    const key = runtimeString(raw), id = runtimeString(expected), mapped = await this.aliasId(kind, key);
    const protocolIdentity = ['agent', 'runner', 'terminal'].includes(kind) && !ResourceIdSchema.safeParse(id).success;
    if (protocolIdentity ? mapped !== undefined || key !== id : mapped !== ResourceIdSchema.parse(id))
      throw precondition('运行环境当前记录与历史原身份不符');
  }
  memberCount(ending: string) {
    let pending = this.memberCounts.get(ending);
    if (!pending) {
      pending = this.db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM task_runtime.development_parent_ending_children WHERE ending_id=${ending}`)
        .then((rows) => rows[0]!.count);
      this.memberCounts.set(ending, pending);
    }
    return pending;
  }
  listOrigins() {
    return [...this.origins.values()].sort((a, b) => Buffer.compare(Buffer.from(JSON.stringify([a.kind, a.key])), Buffer.from(JSON.stringify([b.kind, b.key]))));
  }
}
