import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionOwner, ProjectDeletionTarget } from '@crewstation/contracts';
import { ConfirmProjectDeletionRepairSchema, ProjectDeletionContextSchema, ProjectDeletionInventorySchema, ProjectDeletionRepairItemSchema } from '@crewstation/contracts';
import type { ProjectDeletionRepairItem, ProjectDeletionRepairOwner } from '@crewstation/contracts';
import { isPlatformError, jsonHash, precondition } from '@crewstation/kernel';
import { z } from 'zod';
import { NativePostgresStorageSourceSchema } from '../api/storageSource';
import type { NativeDeletionConfirmations, NativeDeletionHistory, NativeDeletionPhysics, NativeDeletionPlan, NativeDeletionProof, NativeDeletionRepository, NativeDeletionScope, NativeDeletionSnapshot } from '../ports/dataPlane';

const hash = z.string().regex(/^[a-f0-9]{64}$/), name = z.string().regex(/^cs_[a-z0-9_]{1,60}$/), key = z.string().min(1).max(512);
const oid = z.string().regex(/^[1-9][0-9]{0,9}$/).refine((value) => Number(value) <= 4294967295);
const named = z.object({ kind: z.enum(['database', 'role']), name });
const catalog = named.extend({ oid });
const planSchema = z.object({ keys: z.array(key), names: z.array(named), catalog: z.array(catalog), sources: z.array(NativePostgresStorageSourceSchema), sessions: z.array(z.object({ pid: z.number().int().positive(), started: z.string().min(1), sourceIdentity: hash })) });
const original = z.object({ name, oid, source: hash, identity: hash });
const scopeSchema = z.object({ version: z.literal(1), plan: planSchema, storage: NativePostgresStorageSourceSchema.nullable(), databases: z.array(original.extend({ directories: z.array(z.object({ tablespaceOid: oid.nullable(), root: z.string().min(1) })).min(1) })), roles: z.array(original), absent: z.array(named) });
type History = Awaited<ReturnType<NativeDeletionHistory['read']>>;
const blocker = (code: string, message: string, resourceId?: string) => ({ participant: 'data-control' as const, code, message, ...(resourceId ? { resourceId } : {}) });
const unique = <T>(values: readonly T[]) => [...new Map(values.map((value) => [jsonHash(value), value])).values()].sort((a, b) => jsonHash(a).localeCompare(jsonHash(b)));

function deletionPlan(history: History, snapshot: NativeDeletionSnapshot, currentBaseline = false) {
  const names: NativeDeletionPlan['names'][number][] = [], catalogEntries: NativeDeletionPlan['catalog'][number][] = [], sources: NativeDeletionPlan['sources'][number][] = [], sessions: NativeDeletionPlan['sessions'][number][] = [];
  const blockers = [...history.blockers];
  const keys = unique([...snapshot.entities, ...snapshot.credentials.map((row) => row.resourceId), ...history.records.flatMap((row) => [row.resourceId, ...row.aliases])]);
  for (const row of history.records) for (const declared of row.names) {
    names.push({ kind: declared.kind, name: declared.name });
    if (declared.oid !== undefined) catalogEntries.push({ kind: declared.kind, name: declared.name, oid: declared.oid });
  }
  for (const credential of snapshot.credentials) names.push({ kind: 'role', name: credential.role });
  for (const work of snapshot.journal) {
    if (work.nativeSession) sessions.push(work.nativeSession);
    for (const locked of work.names) for (const kind of ['database', 'role'] as const) names.push({ kind, name: locked });
    if (work.journalVersion !== 1) {
      if (!currentBaseline) blockers.push(blocker('native-history-unrecorded', '旧原生回调缺少独立原身份；不能用当前目录或退出状态补造原回收证明', work.resourceId));
      else if (work.state !== 'finished' || !work.nativeSession || !work.process) blockers.push(blocker('native-original-consumer-unknown', '旧回调缺少原实际连接/容器身份或真实退出状态，不能重新确权', work.resourceId));
      continue;
    }
    if (work.before === null) {
      if (work.state !== 'finished') blockers.push(blocker('native-effect-pending', '原生回调尚未固定副作用前身份；需先等待原准入退出', work.resourceId));
      continue; // v1 commits BEFORE before entering the caller; never interpret a legacy NULL this way.
    }
    if (!work.after || !work.before.storage || !work.after.storage) { blockers.push(blocker('native-history-incomplete', '原生回调缺少完整前后 SQL 或独立存储身份', work.resourceId)); continue; }
    sources.push(work.before.storage, work.after.storage);
    catalogEntries.push(...work.before.catalog, ...work.after.catalog);
    for (const fact of [...work.before.catalog, ...work.after.catalog]) names.push({ kind: fact.kind, name: fact.name });
  }
  if (snapshot.foreignKeys.length) blockers.push(blocker('native-owner-conflict', '数据原身份或别名已归属其他项目，禁止接管'));
  if (snapshot.unownedCredentials.length) blockers.push(blocker('native-credential-owner-unknown', '存在无法归属的旧数据库凭据，需先完成原身份核对'));
  const covered = new Set(snapshot.journal.filter((work) => work.journalVersion === 1 && work.before !== null && work.after !== null && work.before.storage && work.after.storage).flatMap((work) => work.names));
  if (!currentBaseline && names.some((entry) => !covered.has(entry.name))) blockers.push(blocker('native-name-history-unrecorded', '部分原名字缺少完整原生回调事实；当前 absent 或元数据状态不能证明从未供给'));
  const plan = planSchema.parse({ keys, names: unique(names), catalog: unique(catalogEntries), sources: [...new Map(sources.map((source) => [source.identity, source])).values()], sessions: unique(sessions) });
  return { plan, blockers: unique(blockers) };
}
function physicalResources(scope: NativeDeletionScope): ProjectDeletionInventory['resources'] {
  const resources: ProjectDeletionInventory['resources'] = [];
  for (const [kind, entries] of [['postgres-database', scope.databases], ['postgres-role', scope.roles]] as const) for (const entry of entries) resources.push({ kind, id: entry.name, identity: entry.identity, sourceIdentity: entry.identity, count: 1, scope: 'physical' });
  for (const entry of scope.absent) {
    const identity = jsonHash({ ...entry, storage: scope.storage?.identity ?? null });
    resources.push({ kind: 'postgres-absent:' + entry.kind, id: entry.name, identity, sourceIdentity: identity, count: 0, scope: 'physical' });
  }
  return resources.sort((a, b) => (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id));
}
function validateScope(raw: NativeDeletionScope, plan?: NativeDeletionPlan): NativeDeletionScope {
  const scope = scopeSchema.parse(raw);
  if (plan && jsonHash(scope.plan) !== jsonHash(plan) || scope.plan.names.length && !scope.storage) throw precondition('原数据库物理范围未绑定完整名字或独立来源');
  const expected = scope.plan.names.map((entry) => entry.kind + ':' + entry.name), actual = [...scope.databases.map((entry) => 'database:' + entry.name), ...scope.roles.map((entry) => 'role:' + entry.name), ...scope.absent.map((entry) => entry.kind + ':' + entry.name)];
  if (new Set(expected).size !== expected.length || new Set(actual).size !== actual.length || jsonHash([...expected].sort()) !== jsonHash(actual.sort())) throw precondition('原数据库物理范围遗漏或重复原名字');
  if (scope.plan.sources.some((source) => source.identity !== scope.storage?.identity)) throw precondition('原生历史与当前独立存储身份不符');
  for (const [kind, entries] of [['database', scope.databases], ['role', scope.roles]] as const) for (const entry of entries) if (!scope.plan.catalog.some((fact) => fact.name === entry.name && fact.oid === entry.oid && fact.kind === kind)) throw precondition('当前原生 OID 缺少保留历史归属，不能认领');
  for (const absent of scope.absent) if (scope.plan.catalog.some((fact) => fact.kind === absent.kind && fact.name === absent.name)) throw precondition('原生历史 OID 已无当前实体，仍需原文件和原来源证明');
  return scope;
}
const inventory = (snapshot: NativeDeletionSnapshot, scope: NativeDeletionScope | null, blockers: ProjectDeletionInventory['blockers'], references: ProjectDeletionInventory['references'], complete: boolean, historyRevision: string): ProjectDeletionInventory => {
  const resources = [...snapshot.metadata, ...(scope ? physicalResources(scope) : [])];
  const nativePlan = scope ? { keys: scope.plan.keys, names: scope.plan.names, catalog: scope.plan.catalog, sources: scope.plan.sources.map((entry) => entry.identity), sessions: scope.plan.sessions } : null;
  return ProjectDeletionInventorySchema.parse({ participant: 'data-control', revision: jsonHash({ resources, nativePlan, historyRevision }), resources, blockers, references, complete });
};
const done = (_context: ProjectDeletionContext, kind: 'physical' | 'metadata' | 'not-applicable', digest: string, count: number) => ({ kind: 'done' as const, evidence: { kind, digest, count, description: kind === 'physical' ? '原库、角色、实际消费者与独立原存储已按持久范围核对' : kind === 'metadata' ? '数据库准入与本项目原凭据、回调事实及归属按阶段处理' : '命名空间由集群 owner 最后清理' } });
function physicalResult(context: ProjectDeletionContext, result: NativeDeletionProof) {
  if (result.kind === 'waiting') return { kind: 'waiting' as const, reason: result.reason };
  if (!hash.safeParse(result.digest).success || !Number.isSafeInteger(result.count) || result.count < 0) throw precondition('原数据库物理证明格式不合法');
  return done(context, 'physical', result.digest, result.count);
}

/** Full owner protocol; no product entry is opened by registering this internal factory. */
interface NativeOwnerInput { history: NativeDeletionHistory; repository: NativeDeletionRepository; physics: NativeDeletionPhysics; confirmations?: NativeDeletionConfirmations; assertGrant(context: ProjectDeletionContext): Promise<void> }
const currentScopeDigest = (scope: NativeDeletionScope) => {
  const source = ({ observedAt: _observedAt, ...identity }: NativeDeletionScope['plan']['sources'][number]) => identity;
  return jsonHash({ ...scope, storage: scope.storage ? source(scope.storage) : null, plan: { ...scope.plan, sources: scope.plan.sources.map(source) } });
};
async function nativeRepairCandidate(input: NativeOwnerInput, target: ProjectDeletionTarget, history?: History, snapshot?: NativeDeletionSnapshot) {
  history ??= await input.history.read(target.id);
  snapshot ??= await input.repository.snapshot(target.id, history.records.flatMap((row) => [row.resourceId, ...row.aliases]));
  if (!snapshot.journal.some((row) => row.journalVersion === null)) return undefined;
  const prepared = deletionPlan(history, snapshot, true), blockers = prepared.blockers.map((entry) => entry.message);
  if (!history.complete || history.references.length) blockers.push('原数据归属/分页不完整或仍有其他项目引用');
  const originalDigest = jsonHash({ target: target.id, history, snapshot }); let scope: NativeDeletionScope | undefined;
  if (!blockers.length) {
    try {
      if (!input.physics.captureCurrent) throw precondition('当前物理确权来源未装配');
      scope = validateScope(await input.physics.captureCurrent(prepared.plan));
      if (jsonHash(scope.plan.keys) !== jsonHash(prepared.plan.keys) || jsonHash(scope.plan.names) !== jsonHash(prepared.plan.names) || jsonHash(scope.plan.sessions) !== jsonHash(prepared.plan.sessions)) throw precondition('当前基线改变了完整旧名字或原连接范围');
      if (!scope.storage || !scope.databases.length) throw precondition('当前基线不能只凭名称或 absent 确认');
    } catch { blockers.push('当前服务器、OID、独立卷/目录、角色依赖或原实际消费者尚未完整核对'); scope = undefined; }
  }
  const evidenceDigest = jsonHash({ target: target.id, scope: scope ? currentScopeDigest(scope) : null, blockers });
  const saved = scope ? await input.confirmations?.read(target.id, originalDigest, evidenceDigest) : undefined;
  if (saved && currentScopeDigest(validateScope(saved.scope)) !== currentScopeDigest(scope!)) throw precondition('当前原生基线确认正文与实际完整范围不符');
  const item: ProjectDeletionRepairItem = ProjectDeletionRepairItemSchema.parse({ owner: 'data-control', key: 'postgres-current', title: 'PostgreSQL 当前完整资源基线', originalDigest, evidenceDigest,
    facts: [{ label: '旧历史', value: String(snapshot.journal.filter((row) => row.journalVersion === null).length) + ' 条 before/after 仍为 NULL；不会补写' },
      ...prepared.plan.names.map((row) => ({ label: '已登记原名字', value: row.kind + ': ' + row.name })),
      ...(scope?.databases ?? []).map((row) => ({ label: '当前实际数据库', value: row.name + ' · OID ' + row.oid + ' · 来源 ' + row.source })),
      ...(scope?.roles ?? []).map((row) => ({ label: '当前实际角色', value: row.name + ' · OID ' + row.oid })),
      ...(scope?.storage ? [{ label: '实际服务器 Pod / 容器', value: scope.storage.server.podUid + ' / ' + scope.storage.server.containerId },
        ...scope.storage.volumes.map((volume) => ({ label: '独立原卷 / 实际目录', value: volume.pvcUid + ' / ' + volume.pvUid + ' / ' + volume.providerPath }))] : []),
      ...(scope?.databases ?? []).flatMap((row) => row.directories.map((directory) => ({ label: '数据库实际目录根', value: row.name + ' / ' + directory.root + ' / ' + row.oid }))),
      { label: '原消费者', value: '按原连接出生、原服务器和当前库/角色核对；活跃连接、预备事务或复制槽会阻断' },
      { label: '保存后的行为', value: '仅保存当前基线；后续两次确认后仍执行实际停止、回收和独立目录复核' }],
    allowedDecisions: blockers.length ? [] : ['reclaim'], blockers, confirmed: saved ? { decision: 'reclaim', actorId: saved.actor, confirmedAt: saved.at } : null });
  return { item, scope };
}

function nativeOperatorRepairs(input: NativeOwnerInput): { repairs: ProjectDeletionRepairOwner; baseline(target: ProjectDeletionTarget, history: History, snapshot: NativeDeletionSnapshot): Promise<NativeDeletionScope | undefined> } {
  return {
    baseline: async (target, history, snapshot) => { const candidate = await nativeRepairCandidate(input, target, history, snapshot); return candidate?.item.confirmed ? candidate.scope : undefined; },
    repairs: {
      inspect: async (target) => { const result = await nativeRepairCandidate(input, target); return result ? [result.item] : []; },
      confirm: async (target, actor, raw) => {
        const request = ConfirmProjectDeletionRepairSchema.parse(raw), candidate = await nativeRepairCandidate(input, target);
        if (!actor.isAdmin || !candidate?.scope || request.owner !== 'data-control' || request.key !== 'postgres-current' || request.decision !== 'reclaim' || candidate.item.blockers.length
          || request.originalDigest !== candidate.item.originalDigest || request.evidenceDigest !== candidate.item.evidenceDigest) throw precondition('原生当前基线已变化或不完整，请重新核对');
        const verify = async () => {
          const fresh = await nativeRepairCandidate(input, target);
          if (!fresh?.scope || fresh.item.originalDigest !== request.originalDigest || fresh.item.evidenceDigest !== request.evidenceDigest) throw precondition('原生来源在实际准入内重读发生变化，未保存确认');
        };
        const saved = await input.confirmations!.save(target.id, actor, request.originalDigest, request.evidenceDigest, candidate.scope, verify);
        return { ...candidate.item, confirmed: { decision: 'reclaim', actorId: saved.actor as typeof actor.userId, confirmedAt: saved.at } };
      },
    },
  };
}
export function nativePostgresDeletionOwner(input: NativeOwnerInput): ProjectDeletionOwner {
  const operator = input.confirmations && input.physics.captureCurrent ? nativeOperatorRepairs(input) : undefined;
  const inspect = async (target: ProjectDeletionTarget) => {
    const history = await input.history.read(target.id);
    if (!hash.safeParse(history.revision).success) throw precondition('原数据保留历史摘要不合法');
    const snapshot = await input.repository.snapshot(target.id, history.records.flatMap((row) => [row.resourceId, ...row.aliases]));
    const prepared = deletionPlan(history, snapshot);
    if (!history.complete || prepared.blockers.length) {
      const current = history.complete && operator ? await operator.baseline(target, history, snapshot) : undefined;
      if (current) return { report: inventory(snapshot, current, [], history.references, true, history.revision), scope: current };
      return { report: inventory(snapshot, null, prepared.blockers, history.references, false, history.revision), scope: null };
    }
    let scope: NativeDeletionScope;
    try { scope = validateScope(await input.physics.capture(prepared.plan), prepared.plan); }
    catch (error) {
      if (!isPlatformError(error)) throw precondition('原生物理来源未完整核对；未生成删除盘点');
      if (error.details['code'] === 'native_postgres_foreign_dependency') return { report: inventory(snapshot, null, [blocker('native-foreign-dependencies', '数据库角色仍被项目外对象或成员引用；需先解除外部依赖')], history.references, false, history.revision), scope: null };
      return { report: inventory(snapshot, null, [blocker('native-physical-source-unavailable', '原 OID、原生锁、保留历史或独立存储暂时无法完整核对')], history.references, false, history.revision), scope: null };
    }
    return { report: inventory(snapshot, scope, [], history.references, true, history.revision), scope };
  };
  return { participant: 'data-control', ...(operator ? { repairs: operator.repairs } : {}), inspect: async (target) => (await inspect(target)).report, run: async (raw) => {
    const context = ProjectDeletionContextSchema.parse(raw);
    if (context.confirmed.participant !== 'data-control' || !context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length) throw precondition('数据库永久清理许可未完整确认');
    await input.assertGrant(context);
    if (context.phase === 'seal') {
      await input.repository.close(context);
      const previous = await input.repository.load(context);
      if (previous.scope) {
        const scope = validateScope(previous.scope), current = validateScope(await input.physics.capture(scope.plan), scope.plan);
        const physical = (entries: ProjectDeletionInventory['resources']) => jsonHash(entries.filter((entry) => entry.scope === 'physical').map((entry) => [entry.kind, entry.id, entry.identity, entry.sourceIdentity, entry.count]).sort());
        if (physical(physicalResources(scope)) !== physical(physicalResources(current)) || physical(physicalResources(scope)) !== physical(context.confirmed.resources)) throw precondition('原数据库 seal 重试的已固定物理身份不符');
        return done(context, 'metadata', jsonHash({ operationId: context.operationId, revision: context.confirmed.revision, sealed: true }), scope.plan.keys.length);
      }
      const current = await inspect(context.target);
      if (!current.scope || current.report.revision !== context.confirmed.revision || current.report.references.length) return { kind: 'blocked', blockers: [blocker('native-inventory-changed', '原数据库或保留内容在确认后变化；准入已关闭，需重新核对原范围')] };
      await input.repository.bind(context, current.scope);
      return done(context, 'metadata', jsonHash({ operationId: context.operationId, revision: context.confirmed.revision, sealed: true }), current.scope.plan.keys.length);
    }
    const stored = await input.repository.load(context);
    if (stored.completed) {
      if (context.phase !== 'verify') throw precondition('数据库清理已经完成，不能重开旧阶段');
      return done(context, 'physical', stored.completed.digest, stored.completed.count);
    }
    if (!stored.scope) throw precondition('原数据库物理意图尚未固定');
    const scope = validateScope(stored.scope);
    try { return await runSealed(input, context, scope, stored); }
    catch (error) {
      if (isPlatformError(error) && error.details['code'] === 'native_postgres_busy') return { kind: 'waiting', reason: '原原生连接仍持有名字锁，等待真实退出' };
      if (isPlatformError(error) && error.details['code'] === 'native_postgres_source_busy') return { kind: 'waiting', reason: '独立原存储探针正在观测，稍后继续同一持久意图' };
      if (isPlatformError(error) && error.details['code'] === 'native_postgres_foreign_dependency') return { kind: 'waiting', reason: '原角色仍有项目外对象或成员依赖，保留凭据并等待解除' };
      throw error;
    }
  } };
}
async function runSealed(input: Parameters<typeof nativePostgresDeletionOwner>[0], context: ProjectDeletionContext, scope: NativeDeletionScope, stored: Awaited<ReturnType<NativeDeletionRepository['load']>>) {
  if (context.phase === 'namespace') return done(context, 'not-applicable', jsonHash({ participant: 'data-control', namespace: context.target.namespace }), 0);
  if (context.phase === 'metadata') {
    if (!stored.proofs.stop || !stored.proofs.purge || !stored.proofs.prove) throw precondition('原数据库尚未排空、回收并独立复核');
    const actual = await input.physics.prove(scope);
    if (actual.kind !== 'done') return physicalResult(context, actual);
    await input.repository.purgeMetadata(context);
    return done(context, 'metadata', jsonHash({ operationId: context.operationId, purged: true }), scope.plan.keys.length);
  }
  if (context.phase === 'purge' && !stored.proofs.stop || context.phase === 'prove' && !stored.proofs.purge || context.phase === 'verify' && (!stored.proofs.prove || !stored.metadataPurged)) throw precondition('原数据库清理缺少上一阶段持久证明');
  const result = context.phase === 'stop' ? await input.physics.stop(scope) : context.phase === 'purge' ? await input.physics.purge(context, scope) : await input.physics.prove(scope);
  const step = physicalResult(context, result);
  if (result.kind === 'done') {
    if (context.phase === 'verify') await input.repository.complete(context, result.digest, result.count);
    else await input.repository.record(context, result.digest);
  }
  return step;
}
