import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionStepResult, ProjectDeletionTarget } from '@crewstation/contracts';
import { ProjectDeletionInventorySchema, ProjectDeletionStepResultSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';

interface PhysicalSource {
  inspect(target: ProjectDeletionTarget): Promise<ProjectDeletionInventory>;
  seal(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>;
  verify(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>;
}
export function projectResourcePhysics(pods: PhysicalSource & { stop(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult> }, volumes: PhysicalSource & { purge(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult>; prove(context: ProjectDeletionContext): Promise<ProjectDeletionStepResult> }) {
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
    stop: (context: ProjectDeletionContext) => pods.stop(context),
    purge: (context: ProjectDeletionContext) => volumes.purge(context),
    prove: (context: ProjectDeletionContext) => combined(context, [() => pods.verify(context), () => volumes.prove(context)]),
    verify: (context: ProjectDeletionContext) => combined(context, [() => pods.verify(context), () => volumes.verify(context)]),
  };
}
