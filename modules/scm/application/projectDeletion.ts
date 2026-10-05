import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionOwner, ProjectDeletionStepResult, ProjectDeletionTarget } from '@crewstation/contracts';
import { ProjectDeletionBlockerSchema, ProjectDeletionContextSchema, ProjectDeletionInventorySchema, ProjectDeletionReferenceSchema, ProjectIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { z } from 'zod';
import { SCM_STORAGE_KINDS } from '../ports/projectDeletion';
import type { ScmDeletionPhysics, ScmDeletionPlan, ScmDeletionProof, ScmDeletionRepository, ScmDeletionScope, ScmDeletionSourceReport, ScmDeletionStored } from '../ports/projectDeletion';
import type { RepositoryWrites, ScmWriteHistory } from '../ports/repositoryWrites';
import type { ScmCurrentRepositoryOriginsSource } from '../ports/currentRepositoryOrigins';
import { scmCurrentRepositoryOrigins, ScmCurrentRepositoryOriginsWitnessSchema } from './currentRepositoryOrigins';

const hash = z.string().regex(/^[a-f0-9]{64}$/), remoteId = z.string().regex(/^[1-9][0-9]*$/).refine((v) => Number.isSafeInteger(Number(v)));
const path = z.string().min(1).max(512).regex(/^[^\x00-\x20\x7f]+$/), timestamp = z.iso.datetime({ offset: true });
const original = z.object({ remoteProjectId: remoteId, pathWithNamespace: path, createdAt: timestamp.nullable() }).strict();
const planSchema = z.object({ projectId: ProjectIdSchema, serviceIds: z.array(z.uuid()), credentialIds: z.array(z.uuid()), repositories: z.array(original),
  credentials: z.array(z.object({ remoteProjectId: remoteId, remoteTokenId: remoteId, createdAt: timestamp.nullable(), userId: remoteId.nullable() }).strict()),
  currentOrigins: ScmCurrentRepositoryOriginsWitnessSchema.optional(),
}).strict();
const reportSchema = z.object({ complete: z.boolean(), blockers: z.array(ProjectDeletionBlockerSchema), references: z.array(ProjectDeletionReferenceSchema) }).strict();
const proofSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('waiting'), reason: z.string().min(1).max(1000) }).strict(),
  z.object({ kind: z.literal('blocked'), blockers: z.array(ProjectDeletionBlockerSchema).min(1) }).strict(),
  z.object({ kind: z.literal('done'), digest: hash, scopeDigest: hash, sourceIdentity: hash, independent: z.boolean(), producersClosed: z.boolean(), consumersStopped: z.boolean(), nativeRemaining: z.number().int().nonnegative(), storageRemaining: z.number().int().nonnegative() }).strict(),
]);
const scopeSchema = z.object({ version: z.literal(1), plan: planSchema, source: z.object({ identity: hash, epoch: hash, version: z.string().min(1).max(80) }).strict(),
  repositories: z.array(original.extend({ createdAt: timestamp, identity: hash })),
  objects: z.array(z.object({ repositoryId: remoteId, kind: z.enum(SCM_STORAGE_KINDS), id: z.string().min(1).max(1024), identity: hash, sourceIdentity: hash, count: z.number().int().nonnegative() }).strict()),
  coverage: z.array(z.object({ repositoryId: remoteId, kind: z.enum(SCM_STORAGE_KINDS), identity: hash, complete: z.literal(true) }).strict()),
  retained: z.array(z.object({ repositoryId: remoteId, identity: hash, contents: z.string().min(1).refine(value => Buffer.byteLength(value) <= 8_388_608) }).strict()).optional(),
}).strict();
const blocker = (code: string, message: string, resourceId?: string) => ({ participant: 'scm' as const, code, message, ...(resourceId ? { resourceId } : {}) });
const historyReferences = (history: ScmWriteHistory) => history.foreignRepositoryReferences.map((entry) => ({ kind: 'gitlab-project-reference', id: entry.remoteProjectId + ':' + entry.projectId, projectId: entry.projectId, description: '其他项目的绑定、原沿革或回调仍引用此原远端仓库' }));
const ordered = <T>(entries: readonly T[]) => [...new Map(entries.map((entry) => [jsonHash(entry), entry])).values()].sort((a, b) => jsonHash(a).localeCompare(jsonHash(b)));
type Input = { writes: RepositoryWrites; repository: ScmDeletionRepository; physics: ScmDeletionPhysics; currentOrigins?: ScmCurrentRepositoryOriginsSource; assertGrant(context: ProjectDeletionContext): Promise<void> };

function deletionPlan(target: ProjectDeletionTarget, history: ScmWriteHistory) {
  const blockers: ProjectDeletionInventory['blockers'] = [], repositories = ordered(history.origins.map(({ remoteProjectId, pathWithNamespace, createdAt }) => ({ remoteProjectId, pathWithNamespace, createdAt })));
  if (!history.metadataComplete) blockers.push(blocker('scm-credential-owner-unknown', '部分旧凭据尚未核对项目归属，不能解释为空'));
  if (history.foreignRepositoryReferences.length) blockers.push(blocker('scm-native-owner-conflict', '原远端仓库仍被其他项目的绑定、历史或回调引用'));
  if (history.unresolvedEffects.length) blockers.push(blocker('scm-effect-unresolved', '原远端请求缺少确定结果；需先恢复原请求的副作用事实'));
  if (repositories.some((entry) => entry.createdAt === null)) blockers.push(blocker('scm-origin-unrecorded', '部分原远端仓库缺少创建身份，不能用当前同名仓库补造回收证明'));
  if (new Set(repositories.map((entry) => entry.remoteProjectId)).size !== repositories.length) blockers.push(blocker('scm-origin-conflict', '同一原远端 ID 的路径或创建身份冲突，需先核对保留来源'));
  const covered = (id: string) => repositories.some((entry) => entry.remoteProjectId === id);
  if (history.bindings.some((entry) => !repositories.some((origin) => origin.remoteProjectId === entry.remoteProjectId && origin.pathWithNamespace === entry.pathWithNamespace))
    || history.records.some((entry) => entry.remoteProjectId !== null && !covered(entry.remoteProjectId))) blockers.push(blocker('scm-repository-history-incomplete', '原绑定或在途工作没有完整远端来源'));
  const effects = history.records.flatMap((work) => work.effects.filter((entry) => entry.stage === 'returned' && entry.kind === 'credential'));
  const credentials = ordered(effects.map((entry) => ({ remoteProjectId: entry.remoteProjectId!, remoteTokenId: entry.remoteTokenId!, createdAt: entry.createdAt ?? null, userId: entry.userId ?? null })));
  if (credentials.some((entry) => entry.createdAt === null || entry.userId === null || !covered(entry.remoteProjectId))
    || history.credentials.some((entry) => !effects.some((effect) => effect.credentialId === entry.id && effect.remoteTokenId === entry.remoteTokenId))) blockers.push(blocker('scm-credential-history-incomplete', '原访问令牌或关联机器人缺少完整远端身份'));
  const plan = planSchema.parse({ projectId: target.id, serviceIds: ordered(history.identities.filter((entry) => entry.kind === 'service').map((entry) => entry.id)),
    credentialIds: ordered(history.identities.filter((entry) => entry.kind === 'credential').map((entry) => entry.id)), repositories, credentials });
  return { plan, blockers };
}
function validateScope(raw: ScmDeletionScope, plan?: ScmDeletionPlan): ScmDeletionScope {
  const scope = scopeSchema.parse(raw);
  if (plan && jsonHash(scope.plan) !== jsonHash(plan)) throw precondition('代码仓库物理范围未绑定本项目完整原历史');
  const current = scope.plan.currentOrigins;
  if (current && (current.projectId !== scope.plan.projectId || jsonHash(current.source) !== jsonHash(scope.source))) throw precondition('当前归属与原物理来源没有绑定同一项目／原实例');
  const expected = scope.plan.repositories.map((entry) => jsonHash({ ...entry, createdAt: entry.createdAt ?? current?.repositories.find((row) => row.remoteProjectId === entry.remoteProjectId && row.pathWithNamespace === entry.pathWithNamespace)?.createdAt ?? null }));
  const actual = scope.repositories.map(({ identity: _identity, ...entry }) => jsonHash(entry));
  if (new Set(expected).size !== expected.length || new Set(actual).size !== actual.length || jsonHash(expected.sort()) !== jsonHash(actual.sort())) throw precondition('代码仓库物理范围遗漏、重复或替换原远端身份');
  if (current && jsonHash(ordered(current.repositories)) !== jsonHash(ordered(scope.repositories))) throw precondition('当前原仓库身份与物理范围不一致');
  const keys = scope.coverage.map((entry) => entry.repositoryId + ':' + entry.kind), all = scope.repositories.flatMap((entry) => SCM_STORAGE_KINDS.map((kind) => entry.remoteProjectId + ':' + kind));
  if (new Set(keys).size !== keys.length || jsonHash(keys.sort()) !== jsonHash(all.sort())) throw precondition('代码仓库存储类别未独立完整覆盖');
  const objects = scope.objects.map((entry) => entry.repositoryId + ':' + entry.kind + ':' + entry.id);
  if (new Set(objects).size !== objects.length || scope.objects.some((entry) => !all.includes(entry.repositoryId + ':' + entry.kind))) throw precondition('代码仓库文件范围重复或引用了其他仓库');
  if (scope.retained && (new Set(scope.retained.map(row => row.repositoryId)).size !== scope.retained.length
    || jsonHash(scope.retained.map(row => row.repositoryId).sort()) !== jsonHash(scope.repositories.map(row => row.remoteProjectId).sort()))) throw precondition('代码仓库保留来源遗漏、重复或属于其他仓库');
  return scope;
}
function physicalResources(scope: ScmDeletionScope): ProjectDeletionInventory['resources'] {
  const resources: ProjectDeletionInventory['resources'] = scope.repositories.map((entry) => ({ kind: 'gitlab-project', id: entry.remoteProjectId, identity: entry.identity, sourceIdentity: entry.identity, scope: 'physical', count: 1 }));
  if (scope.plan.currentOrigins) resources.push({ kind: 'gitlab-current-origins', id: scope.plan.projectId, identity: scope.plan.currentOrigins.digest, sourceIdentity: scope.plan.currentOrigins.source.identity, scope: 'physical', count: 0 });
  for (const entry of scope.objects) resources.push({ kind: 'gitlab-storage:' + entry.kind, id: jsonHash([entry.repositoryId, entry.kind, entry.id]), identity: entry.identity, sourceIdentity: entry.sourceIdentity, scope: 'physical', count: entry.count });
  for (const entry of scope.coverage) resources.push({ kind: 'gitlab-coverage:' + entry.kind, id: entry.repositoryId, identity: entry.identity, sourceIdentity: jsonHash(scope.source), scope: 'physical', count: 0 });
  for (const entry of scope.retained ?? []) resources.push({ kind: 'gitlab-retained-source', id: entry.repositoryId, identity: entry.identity, sourceIdentity: scope.source.identity, scope: 'physical', count: 0 });
  return resources.sort((a, b) => (a.kind + ':' + a.id).localeCompare(b.kind + ':' + b.id));
}
function inventory(target: ProjectDeletionTarget, history: ScmWriteHistory, scope: ScmDeletionScope | null, report: ScmDeletionSourceReport): ProjectDeletionInventory {
  const resources: ProjectDeletionInventory['resources'] = [{ kind: 'metadata:scm', id: target.id, identity: history.revision, scope: 'metadata', count: history.metadataCount }, ...(scope ? physicalResources(scope) : [])];
  return ProjectDeletionInventorySchema.parse({ participant: 'scm', revision: jsonHash(resources), resources, complete: report.complete, blockers: report.blockers, references: report.references });
}
const done = (kind: 'physical' | 'metadata' | 'not-applicable', digest: string, count: number) => ({ kind: 'done' as const, evidence: { kind, digest, count,
  description: kind === 'physical' ? '固定原仓库、全部存储类别与实际生产者和消费者已独立核对' : kind === 'metadata' ? '本项目 SCM 准入、绑定、原凭据及回调材料已按阶段处理' : '项目命名空间由集群 owner 清理' } });
function physicalResult(scope: ScmDeletionScope, proof: ScmDeletionProof, stopOnly = false): ProjectDeletionStepResult {
  proof = proofSchema.parse(proof);
  if (proof.kind === 'waiting') return { kind: 'waiting' as const, reason: proof.reason };
  if (proof.kind === 'blocked') return { kind: 'blocked' as const, blockers: [...proof.blockers] };
  if (!hash.safeParse(proof.digest).success || proof.scopeDigest !== jsonHash(scope) || proof.sourceIdentity !== scope.source.identity
    || !Number.isSafeInteger(proof.nativeRemaining) || proof.nativeRemaining < 0 || !Number.isSafeInteger(proof.storageRemaining) || proof.storageRemaining < 0) throw precondition('代码仓库独立证明没有绑定固定原范围');
  if (!proof.independent || !proof.producersClosed || !proof.consumersStopped) return { kind: 'blocked' as const, blockers: [blocker('scm-consumers-unproven', '代码仓库完整来源、生产者封闭或实际消费者退出尚未证明')] };
  if (!stopOnly && (proof.nativeRemaining !== 0 || proof.storageRemaining !== 0)) return { kind: 'waiting' as const, reason: '原代码仓库或文件仍有残留，继续核对同一批原资源' };
  return done('physical', proof.digest, scope.repositories.length + scope.objects.reduce((total, entry) => total + entry.count, 0));
}

export function scmProjectDeletionOwner(input: Input): ProjectDeletionOwner {
  const inspect = async (target: ProjectDeletionTarget) => {
    const retained = await input.repository.retained(target.id), history = await input.writes.history(target.id, retained?.plan.repositories.map((entry) => entry.remoteProjectId));
    if (retained) {
      const scope = validateScope(retained), source = reportSchema.parse(await input.physics.inspect(scope));
      if (scope.plan.projectId !== target.id) throw precondition('SCM 保留原范围属于其他项目');
      const report = { complete: source.complete && history.metadataComplete && history.unresolvedEffects.length === 0 && history.foreignRepositoryReferences.length === 0 && source.blockers.length === 0 && source.references.length === 0,
        blockers: [...source.blockers, ...(!history.metadataComplete ? [blocker('scm-credential-owner-unknown', '部分旧凭据归属未知，保留原材料')] : []), ...(history.unresolvedEffects.length ? [blocker('scm-effect-unresolved', '保留范围仍有未闭合原副作用，不能用当前身份替代原结果')] : [])], references: [...source.references, ...historyReferences(history)] };
      return { report: inventory(target, history, scope, report), scope };
    }
    const prepared = deletionPlan(target, history);
    const recoverable = new Set(['scm-origin-unrecorded', 'scm-credential-history-incomplete']);
    if (input.currentOrigins && prepared.plan.repositories.length && prepared.blockers.every((entry) => recoverable.has(entry.code))) {
      const historyHash = jsonHash(history), raw = await input.currentOrigins.read(target, history);
      const after = await input.writes.history(target.id);
      if (jsonHash(history) !== historyHash || after.revision !== history.revision) return { report: inventory(target, after, null, { complete: false, blockers: [blocker('scm-source-history-changed', '当前归属读取期间原历史变化，需重新核对')], references: historyReferences(after) }), scope: null };
      prepared.plan.currentOrigins = ScmCurrentRepositoryOriginsWitnessSchema.parse(scmCurrentRepositoryOrigins(target.id, history, raw));
      prepared.blockers.length = 0;
    }
    if (prepared.blockers.length) return { report: inventory(target, history, null, { complete: false, blockers: prepared.blockers, references: historyReferences(history) }), scope: null };
    const captured = await input.physics.capture(prepared.plan), scope = captured.scope ? validateScope(captured.scope, prepared.plan) : null;
    const source = reportSchema.parse({ complete: captured.complete, blockers: captured.blockers, references: captured.references });
    const report = { ...source, complete: source.complete && scope !== null && source.blockers.length === 0 && source.references.length === 0 };
    return { report: inventory(target, history, scope, report), scope };
  };
  return { participant: 'scm', inspect: async (target) => (await inspect(target)).report, run: async (raw) => {
    const context = ProjectDeletionContextSchema.parse(raw);
    if (context.confirmed.participant !== 'scm' || !context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length) throw precondition('代码仓库永久清理许可未完整确认');
    await input.assertGrant(context);
    if (context.phase === 'seal') {
      await input.writes.close(context);
      const stored = await input.repository.load(context);
      if (stored.scope) {
        const scope = validateScope(stored.scope), confirmed = context.confirmed.resources.filter((entry) => entry.scope === 'physical');
        if (jsonHash(physicalResources(scope)) !== jsonHash(confirmed)) throw precondition('已固定的原代码仓库范围与重新确认不符');
        return done('metadata', jsonHash({ operationId: context.operationId, sealed: true, revision: context.confirmed.revision }), scope.plan.serviceIds.length);
      }
      const current = await inspect(context.target);
      if (!current.scope || !current.report.complete || current.report.revision !== context.confirmed.revision) return { kind: 'blocked', blockers: [blocker('scm-inventory-changed', '确认后原代码仓库内容变化；准入已封闭，需重新核对')] };
      await input.repository.bind(context, current.scope);
      return done('metadata', jsonHash({ operationId: context.operationId, sealed: true, revision: context.confirmed.revision }), current.scope.plan.serviceIds.length);
    }
    const stored = await input.repository.load(context);
    if (stored.completed) {
      if (context.phase !== 'verify') throw precondition('代码仓库清理已完成，不能重开旧阶段');
      return done('physical', stored.completed.digest, stored.completed.count);
    }
    if (!stored.scope) throw precondition('原代码仓库物理范围尚未固定');
    return runSealed(input, context, validateScope(stored.scope), stored);
  } };
}
async function runSealed(input: Input, context: ProjectDeletionContext, scope: ScmDeletionScope, stored: ScmDeletionStored): Promise<ProjectDeletionStepResult> {
  const history = await input.writes.history(context.target.id, scope.plan.repositories.map((entry) => entry.remoteProjectId));
  if (history.foreignRepositoryReferences.length) return { kind: 'blocked' as const, blockers: [blocker('scm-native-owner-conflict', '固定原远端仓库仍被其他项目引用，保留原资源')] };
  if (context.phase === 'namespace') return done('not-applicable', jsonHash({ participant: 'scm', namespace: context.target.namespace }), 0);
  if (context.phase === 'metadata') {
    if (!stored.proofs.stop || !stored.proofs.purge || !stored.proofs.prove) throw precondition('原代码仓库尚未排空、回收并独立复核');
    const proof = await input.physics.prove(scope); await input.assertGrant(context);
    const result = physicalResult(scope, proof);
    if (result.kind !== 'done') return result;
    await input.repository.purgeMetadata(context);
    return done('metadata', jsonHash({ operationId: context.operationId, metadataPurged: true }), scope.plan.serviceIds.length + scope.plan.credentialIds.length);
  }
  if (context.phase === 'purge' && !stored.proofs.stop || context.phase === 'prove' && !stored.proofs.purge || context.phase === 'verify' && (!stored.proofs.prove || !stored.metadataPurged)) throw precondition('代码仓库清理缺少上一阶段持久证明');
  if (context.phase === 'stop') {
    await input.writes.recover(context);
    if ((await input.writes.history(context.target.id)).records.some((entry) => entry.state !== 'exited' || !entry.exitDigest)) return { kind: 'waiting', reason: '原平台 SCM 回调尚未实际退出' };
  }
  if (scope.plan.projectId !== context.target.id) throw precondition('固定的原 SCM 范围属于其他项目');
  const proof = context.phase === 'stop' ? await input.physics.stop(context, scope) : context.phase === 'purge' ? await input.physics.purge(context, scope) : await input.physics.prove(scope);
  await input.assertGrant(context);
  const result = physicalResult(scope, proof, context.phase === 'stop');
  if (result.kind === 'done') {
    if (context.phase === 'verify') await input.repository.complete(context, result.evidence.digest, result.evidence.count);
    else await input.repository.record(context, result.evidence.digest);
  }
  return result;
}
