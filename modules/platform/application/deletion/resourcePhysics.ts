import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionStepResult, ProjectDeletionTarget } from '@crewstation/contracts';
import { ProjectDeletionInventorySchema, ProjectDeletionStepResultSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { NativeDeletionHistoryInputs, NativeDeletionHistoryPort } from '../../ports/projectResourceSources';

interface PhysicalSource {
  inspect(target: ProjectDeletionTarget): Promise<ProjectDeletionInventory>;
  seal(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>;
  verify(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>;
}
export function projectResourcePhysics(pods: PhysicalSource & { observeTerminating(context: ProjectDeletionContext): Promise<void>; stop(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult> }, volumes: PhysicalSource & { purge(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>; prove(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult> }) {
  const combined = async (context: ProjectDeletionContext, steps: Array<() => Promise<ProjectDeletionStepResult>>) => {
    const proofs = [];
    for (const step of steps) {
      const result = ProjectDeletionStepResultSchema.parse(await step()); if (result.kind !== 'done') return result;
      if (context.phase !== 'seal' && result.evidence.kind !== 'physical') throw precondition('物理资源来源只能以实际停止与回收证明完成');
      proofs.push(result.evidence);
    }
    return { kind: 'done' as const, evidence: { kind: context.phase === 'seal' ? 'metadata' as const : 'physical' as const, digest: jsonHash(proofs), description: context.phase === 'seal' ? '原 Pod 停止保护与原卷供应器身份已固定' : '原 Pod 终止与原卷供应器物理回收均有独立来源证明', count: proofs.reduce((n, proof) => n + proof.count, 0) } };
  };
  return {
    inspect: async (target: ProjectDeletionTarget): Promise<ProjectDeletionInventory> => {
      const reports = (await Promise.all([pods.inspect(target), volumes.inspect(target)])).map((report) => ProjectDeletionInventorySchema.parse(report));
      if (reports.some((report) => report.participant !== 'resources')) throw precondition('物理盘点来源与资源 owner 不符');
      const resources = reports.flatMap((report) => report.resources), unique = <T>(entries: T[]) => [...new Map(entries.map((entry) => [jsonHash(entry), entry])).values()];
      return { participant: 'resources', complete: reports.every((report) => report.complete), resources, revision: jsonHash(resources), references: unique(reports.flatMap((report) => report.references)), blockers: unique(reports.flatMap((report) => report.blockers)) };
    },
    seal: (context: ProjectDeletionContext) => combined(context, [() => pods.seal(context), () => volumes.seal(context)]),
    observeTerminating: (context: ProjectDeletionContext) => pods.observeTerminating(context),
    stop: (context: ProjectDeletionContext) => pods.stop(context),
    purge: (context: ProjectDeletionContext) => volumes.purge(context),
    prove: (context: ProjectDeletionContext) => combined(context, [() => pods.verify(context), () => volumes.prove(context)]),
    verify: (context: ProjectDeletionContext) => combined(context, [() => pods.verify(context), () => volumes.verify(context)]),
  };
}

/** Read-only inversion: no table access across owners, credential issuance or platform availability check. */
export function nativeDeletionRetainedHistory(data: NativeDeletionHistoryInputs['data'], resources: NativeDeletionHistoryInputs['resources'], adminUrl: string): NativeDeletionHistoryPort {
  const endpoint = new URL(adminUrl), nativeName = /^cs_[a-z0-9_]{1,60}$/;
  return { read: async (projectId) => {
    if (!data.nativePostgresHistory) throw precondition('缺少 data 原生保留历史端口');
    const [legacy, ledger] = await Promise.all([data.nativePostgresHistory.read(projectId), resources.projectDeletion.nativePostgresHistory(projectId)]);
    if (legacy.projectId !== projectId || !legacy.retainedRecordsComplete || !ledger.retainedRecordsComplete) throw precondition('原生保留历史来源或完整读取标志不符');
    const blockers: ProjectDeletionInventory['blockers'] = [...legacy.gaps.map((gap) => ({ participant: 'data-control' as const, code: gap.code, message: gap.message, resourceId: gap.id })), ...ledger.gaps.map((gap) => ({ participant: 'data-control' as const, code: gap.code, message: gap.message, resourceId: gap.resourceId }))];
    const records: Awaited<ReturnType<NativeDeletionHistoryPort['read']>>['records'][number][] = [];
    const aliases = (id: string) => legacy.aliases.filter((alias) => alias.id === id && alias.valid).flatMap((alias) => alias.keys);
    const addName = (names: Awaited<ReturnType<NativeDeletionHistoryPort['read']>>['records'][number]['names'][number][], kind: 'database' | 'role', name: string, id: string, oid?: string) => {
      if (!nativeName.test(name)) { blockers.push({ participant: 'data-control', code: 'native-name-unregistered', message: '旧原生名字不属于已登记的平台命名范围，需先核实来源', resourceId: id }); return; }
      names.push({ kind, name, ...(oid !== undefined ? { oid } : {}) });
    };
    const addDsn = (names: Awaited<ReturnType<NativeDeletionHistoryPort['read']>>['records'][number]['names'][number][], dsn: (typeof legacy.resources)[number]['dsn'], id: string) => {
      if (!dsn.origin) return;
      if (dsn.origin.hostname !== endpoint.hostname || dsn.origin.port !== Number(endpoint.port || '5432')) { blockers.push({ participant: 'data-control', code: 'legacy-endpoint-unverified', message: '旧连接串指向另一原生端点，不能凭名字接管当前数据库', resourceId: id }); return; }
      addName(names, 'database', dsn.origin.database, id); addName(names, 'role', dsn.origin.role, id);
    };
    for (const row of legacy.resources) {
      if (row.kind !== 'postgres') continue;
      const names: (typeof records)[number]['names'][number][] = []; addName(names, 'database', row.objectName, row.id); addDsn(names, row.dsn, row.id);
      records.push({ resourceId: row.id, aliases: aliases(row.id), names });
    }
    for (const row of legacy.bindings) {
      const names: (typeof records)[number]['names'][number][] = [];
      if (row.roleName && !(row.mode === 'development' && row.roleName === 'development')) addName(names, 'role', row.roleName, row.id);
      addDsn(names, row.dsn, row.id);
      records.push({ resourceId: row.id, aliases: [...aliases(row.id), ...(row.legacyResourceId ? [row.legacyResourceId] : [])], names });
    }
    for (const row of ledger.records) {
      const names: (typeof records)[number]['names'][number][] = [];
      for (const child of row.declared) addName(names, child.kind === 'PostgresDatabase' ? 'database' : 'role', child.name, row.id);
      for (const child of row.observed) addName(names, child.kind === 'PostgresDatabase' ? 'database' : 'role', child.name, row.id, child.uid);
      records.push({ resourceId: row.id, aliases: row.owner.ref && row.owner.ref !== row.id ? [row.owner.ref] : [], names });
    }
    return { complete: blockers.length === 0, revision: jsonHash({ projectId, data: legacy.revision, resources: ledger.revision }), records, blockers, references: [] };
  } };
}
