import type { Actor, ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionStepResult, ProjectDeletionTarget, ProjectId, RepositoryBindingDto, ServiceId } from '@crewstation/contracts';
import type { ProjectDeletionNativeProofSchema } from '@crewstation/contracts';
import type { z } from 'zod';

export interface NativeProjectGrantPort {
  getProject(actor: Actor, projectId: ProjectId): Promise<{ id: ProjectId; slug: string; createdAt: string }>;
  assertProjectDeletionGrant(context: ProjectDeletionContext): Promise<void>;
  projectDeletionParticipantContext(context: ProjectDeletionContext, participant: 'resources'): Promise<ProjectDeletionContext>;
}
type Grant = NativeProjectGrantPort['assertProjectDeletionGrant'];
interface Receipt { key: string; uid: string; nodeUid: string | null; digest: string; observedAt: string }
interface Receipts { get(context: ProjectDeletionContext, key: string, uid: string): Promise<Receipt | undefined>; save(context: ProjectDeletionContext, receipt: Receipt): Promise<void> }
export interface NativeWorkResourcePort {
  list(filter: { projectId: ProjectId }): Promise<Array<{ owner: { module: string }; spec: { children: readonly { kind: string; name: string; namespace?: string }[] }; children: readonly { kind: string; name: string; namespace?: string }[] }>>;
  projectDeletion: { sealClusterAdmission(context: ProjectDeletionContext, grant: Grant): Promise<void>; assertClusterAdmission(context: ProjectDeletionContext, grant: Grant): Promise<void>; podStopReceipts(grant: Grant): Receipts };
}
export interface NativeWorkClusterPort {
  projectPodProtection(admission: { assertGrant: Grant; seal: Grant; assertSealed: Grant }, receipts: Receipts): {
    stopSelected(context: ProjectDeletionContext, keys: readonly string[]): Promise<ProjectDeletionStepResult>;
  };
}
export interface NativeScmPort { getBinding(actor: Actor, serviceId: ServiceId): Promise<RepositoryBindingDto> }
export interface CallbackProcess { nodeUid: string; nodeName: string; podUid: string; containerId: string; bootId?: string }
export interface RuntimeWorkContent { consumers: readonly { id: string }[]; callbacks: readonly { process: CallbackProcess }[] }
export interface ReleaseWorkContent { consumers: readonly { id: string; aliases: readonly string[] }[]; callbacks: readonly { process: CallbackProcess }[];
  buildInputs?: readonly { serviceId: string; commit: string }[] }
export interface NativeWorkSnapshot { identity: string; epoch: string; body: unknown;
  objects: readonly { kind: 'builder' | 'credential'; id: string; identity: string; sourceIdentity: string; count: number }[] }
type Report = Pick<ProjectDeletionInventory, 'complete' | 'blockers' | 'references'>;
export interface NativeWorkSource<Content> {
  capture(target: ProjectDeletionTarget, content: Content): Promise<Report & { native: NativeWorkSnapshot }>;
  inspect(original: NativeWorkSnapshot): Promise<Report>;
  stop(context: ProjectDeletionContext, original: NativeWorkSnapshot): Promise<z.infer<typeof ProjectDeletionNativeProofSchema>>;
  purge(context: ProjectDeletionContext, original: NativeWorkSnapshot): Promise<z.infer<typeof ProjectDeletionNativeProofSchema>>;
  prove(context: ProjectDeletionContext, original: NativeWorkSnapshot): Promise<z.infer<typeof ProjectDeletionNativeProofSchema>>;
  callbackExit(original: { process: CallbackProcess }): Promise<string | undefined>;
}
