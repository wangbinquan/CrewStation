import type { ProjectDeletionContext, ProjectDeletionEvidence, ProjectDeletionInventory, ProjectDeletionTarget, ProjectId, TaskId } from '@crewstation/contracts';
import type { SessionWorkBirth } from '../domain/deletion/work';
import type { SessionStopSnapshotSchema } from '../domain/deletion/stopSnapshot';
import type { z } from 'zod';

export interface SessionTaskOrigin { readonly id: TaskId; readonly complete: true; readonly scope: 'project' | 'platform'; readonly projectIds: readonly ProjectId[]; readonly revision: string }
export interface SessionDeletionSources {
  readonly processes?: SessionCallbackProcesses;
  resolve(taskKey: string): Promise<SessionTaskOrigin | undefined>;
  tasks(projectId: ProjectId, after: string | null): Promise<readonly TaskId[]>;
  assertAvailable(projectId: ProjectId): Promise<void>;
  assertGrant(context: ProjectDeletionContext): Promise<void>;
}
export interface SessionConnectionBirth {
  readonly id: string; readonly taskId: TaskId; readonly replica: string; readonly at: string; readonly exitKeyHash: string; readonly identity: string;
  readonly process?: SessionCallbackProcess;
}
export interface SessionCallbackProcess { readonly podUid: string; readonly containerId: string; readonly nodeUid: string; readonly nodeName: string;
  readonly pid: number; readonly pidNamespace: string; readonly bootId: string; readonly startTicks: string }
export interface SessionCallbackProcesses {
  protectCurrent(): Promise<SessionCallbackProcess>;
  sweep(accept: { stopped(process: Pick<SessionCallbackProcess, 'podUid' | 'containerId' | 'nodeUid' | 'nodeName'>, digest: string): Promise<void>;
    podStopped(process: Pick<SessionCallbackProcess, 'podUid' | 'nodeUid' | 'nodeName'>, digest: string): Promise<void>; releasable(podUid: string): Promise<boolean> }): Promise<void>;
}
export interface SessionConnectionHistory {
  open<T>(taskId: TaskId, callback: () => Promise<T>): Promise<T>;
  check(taskId: TaskId): Promise<void>;
  birth(input: Omit<SessionConnectionBirth, 'identity' | 'process'>): Promise<SessionConnectionBirth>;
  exit(birth: SessionConnectionBirth, privateKey: string): Promise<void>;
}
export interface SessionDeletionScope {
  readonly taskKeys: readonly string[]; readonly births: readonly SessionConnectionBirth[];
  readonly callbacks?: readonly SessionWorkBirth[];
  readonly stopped?: z.infer<typeof SessionStopSnapshotSchema>;
  readonly digest: string; readonly count: number;
  readonly compacted: boolean;
}
/** Private sealed-data adapter only: the physical SQL key is never a protocol TaskId. */
export interface SessionOriginalTaskStorage { readonly taskId: TaskId; readonly taskKey: string }
export interface SessionDeletionRepository {
  inspect(target: ProjectDeletionTarget): Promise<{ inventory: ProjectDeletionInventory; scope: SessionDeletionScope }>;
  seal(context: ProjectDeletionContext): Promise<boolean>;
  scope(context: ProjectDeletionContext): Promise<SessionDeletionScope>;
  originalTasks(context: ProjectDeletionContext, after: TaskId | null): Promise<readonly TaskId[]>;
  proof(context: ProjectDeletionContext): Promise<ProjectDeletionEvidence | undefined>;
  record(context: ProjectDeletionContext, evidence: ProjectDeletionEvidence): Promise<void>;
  exited(birth: SessionConnectionBirth): Promise<boolean>;
  quiescent(context: ProjectDeletionContext): Promise<boolean>;
  observe(): Promise<void>;
  purge(context: ProjectDeletionContext, evidence: ProjectDeletionEvidence): Promise<void>;
}
export interface SessionDeletionTransport {
  close(context: ProjectDeletionContext, birth: SessionConnectionBirth): Promise<boolean>;
}
