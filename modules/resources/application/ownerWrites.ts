import type { ResourceKind, ResourceReason } from '@crewstation/contracts';
import type { Clock } from '@crewstation/kernel';
import { conflict, forbidden, jsonHash, newResourceId, notFound, quotaExceeded, validation } from '@crewstation/kernel';
import type { ResourceDeclaration, ResourceReport, ResourceWriter } from '../api/types';
import { mergeConditions, ownerConditionViolation } from '../domain/conditions';
import { kindRule, KIND_RULES } from '../domain/kinds';
import type { LedgerRecord, ResourceAlias } from '../domain/record';
import { QUOTA_PHASES } from '../domain/quota';
import type { QuotaLimits } from '../ports/platform';
import type { LedgerScope } from '../ports/repositories';
import { commitRecord } from './commit';

const MAX_CHILDREN = 32;

function checkDeclaration(input: ResourceDeclaration): void {
  if (!(input.kind in KIND_RULES)) throw validation(`未知的资源种类 ${input.kind}`);
  if (input.spec.children.length > MAX_CHILDREN) throw validation(`一条资源最多 ${MAX_CHILDREN} 个子对象`, { kind: input.kind });
  const reserved = ownerConditionViolation(input.conditions ?? []);
  if (reserved) throw validation(`条件 ${reserved} 只能由资源中心写`, { condition: reserved });
}

async function loadOwned(scope: LedgerScope, module: string, id: string): Promise<LedgerRecord> {
  const record = await scope.records.get(id, { forUpdate: true });
  if (!record) throw notFound('资源', id);
  if (record.owner.module !== module) throw forbidden(`资源 ${id} 属于 ${record.owner.module}，${module} 不能改它的期望`);
  return record;
}

async function declareIn(scope: LedgerScope, module: string, input: ResourceDeclaration, now: Date): Promise<LedgerRecord> {
  checkDeclaration(input);
  const owner = { module, ref: input.ref };
  const existing = input.id ? await scope.records.get(input.id, { forUpdate: true }) : await scope.records.getByOwner(owner, input.kind, { forUpdate: true });
  if (existing) {
    if (existing.owner.module !== module || existing.owner.ref !== input.ref || existing.kind !== input.kind) throw conflict(`资源 ${existing.id} 已由 ${existing.owner.module}（${existing.kind}）声明`, { resourceId: existing.id });
    if (existing.desired === 'absent') throw conflict(`资源 ${existing.id} 已受理释放，不能重新声明；请声明一条新资源`, { resourceId: existing.id });
    const specChanged = jsonHash(existing.spec) !== jsonHash(input.spec);
    const draft: LedgerRecord = {
      ...existing, spec: input.spec, generation: specChanged ? existing.generation + 1 : existing.generation,
      display: input.display ?? existing.display, conditions: mergeConditions(existing.conditions, input.conditions ?? [], now),
      ...(input.parentId ? { parentId: input.parentId } : {}), ...(input.purpose ? { purpose: input.purpose } : {}),
      aliases: mergeAliases(existing.aliases, input.aliases ?? []),
    };
    if (draft.aliases.length !== existing.aliases.length) await scope.records.addAliases(existing.id, input.aliases ?? []);
    return commitRecord(scope, existing, draft, now);
  }
  const draft: LedgerRecord = {
    id: input.id ?? newResourceId(), kind: input.kind, ...(input.projectId ? { projectId: input.projectId } : {}), owner,
    ...(input.parentId ? { parentId: input.parentId } : {}), ...(input.purpose ? { purpose: input.purpose } : {}),
    desired: 'present', spec: input.spec, generation: 1, observedGeneration: 0, conditions: mergeConditions([], input.conditions ?? [], now), children: [],
    display: input.display ?? {}, phase: 'pending', phaseSince: now, aliases: input.aliases ?? [], version: 0, createdAt: now, updatedAt: now,
  };
  const saved = await commitRecord(scope, undefined, draft, now);
  if (input.aliases?.length) await scope.records.addAliases(saved.id, input.aliases);
  return saved;
}

function mergeAliases(existing: readonly ResourceAlias[], added: readonly ResourceAlias[]): readonly ResourceAlias[] {
  const known = new Set(existing.map((alias) => `${alias.source}:${alias.alias}`));
  const fresh = added.filter((alias) => !known.has(`${alias.source}:${alias.alias}`));
  return fresh.length ? [...existing, ...fresh] : existing;
}

async function admitIn(scope: LedgerScope, module: string, input: ResourceDeclaration, limits: QuotaLimits, now: Date): Promise<LedgerRecord> {
  const units = kindRule(input.kind).quotaUnits;
  if (!units || !input.projectId) return declareIn(scope, module, input, now);
  const existing = await scope.records.getByOwner({ module, ref: input.ref }, input.kind);
  if (existing) return declareIn(scope, module, input, now);
  await scope.locks.lock(input.projectId);
  const limit = await limits.limitFor(input.projectId);
  if (limit === undefined) throw validation('项目尚未配置并发任务配额');
  const quotaKinds = (Object.keys(KIND_RULES) as ResourceKind[]).filter((kind) => kindRule(kind).quotaUnits > 0);
  const counts = await scope.records.countByKind(input.projectId, quotaKinds, QUOTA_PHASES);
  const used = quotaKinds.reduce((sum, kind) => sum + (counts[kind] ?? 0) * kindRule(kind).quotaUnits, 0);
  if (used + units > limit) throw quotaExceeded(`并发任务已达配额上限 ${limit}`, { projectId: input.projectId, limit, used });
  return declareIn(scope, module, input, now);
}

async function releaseIn(scope: LedgerScope, module: string, id: string, reason: ResourceReason, now: Date): Promise<LedgerRecord> {
  const record = await loadOwned(scope, module, id);
  if (record.desired === 'absent') return record;
  return commitRecord(scope, record, { ...record, desired: 'absent', generation: record.generation + 1, releaseReason: reason }, now);
}

async function reportIn(scope: LedgerScope, module: string, id: string, report: ResourceReport, now: Date): Promise<LedgerRecord> {
  const reserved = ownerConditionViolation(report.conditions ?? []);
  if (reserved) throw validation(`条件 ${reserved} 只能由资源中心写`, { condition: reserved });
  const record = await loadOwned(scope, module, id);
  const { startup: _startup, idleSince: _idle, ...rest } = record;
  const startup = report.startup === undefined ? record.startup : report.startup ?? undefined;
  const idleSince = report.idleSince === undefined ? record.idleSince : report.idleSince ?? undefined;
  const draft: LedgerRecord = {
    ...rest, conditions: mergeConditions(record.conditions, report.conditions ?? [], now), display: report.display ?? record.display,
    ...(startup ? { startup } : {}), ...(idleSince ? { idleSince } : {}),
  };
  return commitRecord(scope, record, draft, now);
}

/** 绑定所属模块与一个写入范围（自己的事务或调用方的事务）的写入口。 */
export function ownerWriter(module: string, run: <T>(fn: (scope: LedgerScope) => Promise<T>) => Promise<T>, limits: QuotaLimits, clock: Clock): ResourceWriter {
  return {
    declare: (input) => run((scope) => declareIn(scope, module, input, clock.now())),
    admit: (input) => run((scope) => admitIn(scope, module, input, limits, clock.now())),
    requestRelease: (id, reason) => run((scope) => releaseIn(scope, module, id, reason, clock.now())),
    report: (id, report) => run((scope) => reportIn(scope, module, id, report, clock.now())),
    find: (ref, kind) => run((scope) => scope.records.getByOwner({ module, ref }, kind)),
  };
}
