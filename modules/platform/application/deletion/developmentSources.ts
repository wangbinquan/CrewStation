import type { Actor, BranchDto, ServiceId } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { InfrastructureSourceModules } from '../../ports/infrastructureOrigins';
import type { SessionProcessObservers, SessionProjectAdmission } from '../../ports/sessionDeletion';

/** Preserve real owner kinds and representations; an absent late module must fail rather than return an empty source. */
export function developmentDeletionSources(project: InfrastructureSourceModules['project'] & SessionProjectAdmission,
  tasks: InfrastructureSourceModules['taskRuntime'], cluster: () => InfrastructureSourceModules['clusterManagement'] | undefined, observers: SessionProcessObservers) {
  return {
    processes: { protectCurrent: observers.protectCurrentProcess, sweep: observers.sweep },
    assertAvailable: project.assertProjectAvailable, assertGrant: project.assertProjectDeletionGrant,
    resolve: async (kind: 'project' | 'task' | 'cluster-operation', key: string, representation: 'current' | 'legacy') => {
      if (kind === 'project') return project.originalInfrastructureOwnership(kind, key, representation);
      if (kind === 'task') return tasks.originalInfrastructureOwnership(kind, key, representation);
      const original = cluster(); if (!original) throw precondition('开发原管理操作来源尚未装配');
      return original.originalInfrastructureOwnership(kind, key, representation);
    },
  };
}
interface DevelopmentSourceControl {
  listBranches(actor: Actor, id: ServiceId, compare: { previewSha?: string; prodSha?: string }): Promise<BranchDto[]>;
  issueSessionCredential(id: ServiceId, minutes: number): Promise<{ token: string; httpUrlWithCredentialTemplate: string; expiresAt: string }>;
  readFile(id: ServiceId, ref: string, path: string): Promise<string | undefined>;
}
/** Session-scoped source-control credentials exist only in the immediate command response. */
export function developmentSourceControl(scm: DevelopmentSourceControl, actor: Actor) {
  return { listBranches: (id: ServiceId, compare: { previewSha?: string; prodSha?: string }) => scm.listBranches(actor, id, compare),
    pushUrl: async (id: ServiceId) => { const original = await scm.issueSessionCredential(id, 60); return {
      url: original.httpUrlWithCredentialTemplate.replace('{token}', encodeURIComponent(original.token)), expiresAt: original.expiresAt }; },
    readFile: (id: ServiceId, ref: string, path: string) => scm.readFile(id, ref, path) };
}
