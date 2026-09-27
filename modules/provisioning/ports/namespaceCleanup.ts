import type { ProjectId } from '@crewstation/contracts';

type Child = { readonly kind: string; readonly name: string; readonly namespace?: string; readonly uid?: string };
type IdentifiedChild = Child & { readonly uid: string };

/** 跨模块清理端口：项目提供归档事实，资源中心原子受理，集群侧完整盘点。 */
export interface NamespaceCleanup {
  project(id: ProjectId): Promise<{ readonly state: string; readonly namespace: string }>;
  record(id: string): Promise<{ readonly kind: string; readonly projectId?: ProjectId; readonly owner: { readonly module: string }; readonly children: readonly Child[] } | undefined>;
  retire(id: string, uid: string, inspect: (name: string, children: readonly IdentifiedChild[]) => Promise<void>): Promise<void>;
  inspect(name: string, uid: string, children: readonly IdentifiedChild[]): Promise<void>;
}
