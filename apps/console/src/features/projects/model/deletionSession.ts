import type { ProjectDeletionsResource } from '@crewstation/api-client';
import { isApiClientError } from '@crewstation/api-client';
import { AcceptProjectDeletionSchema, ProjectDeletionDigestSchema, ProjectDeletionOperationSchema, ProjectDeletionPlanSchema, ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import type { AcceptProjectDeletion, ProjectDeletionOperation, ProjectDeletionPlan } from '@crewstation/contracts';
import { deletionPlanReady } from './deletionReview';

export interface PendingDeletionRequest {
  readonly projectId: string; readonly input: AcceptProjectDeletion; readonly digest: string; readonly operationId?: string;
}
export interface DeletionRequestStore {
  read(projectId: string): unknown;
  write(projectId: string, request: PendingDeletionRequest | undefined): void;
}
export interface DeletionSessionState {
  readonly loading: boolean; readonly pending: boolean; readonly plan?: ProjectDeletionPlan; readonly operation?: ProjectDeletionOperation;
  readonly error?: 'read-failed' | 'request-unknown' | 'cannot-retain-request' | 'plan-invalid' | 'invalid-retained-request';
}

/** Retains only the confirmed request, not resource contents. Polling reads; replay is a separate explicit action. */
export class ProjectDeletionSession {
  private state: DeletionSessionState = { loading: false, pending: false };
  private pending?: PendingDeletionRequest;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly projectId: string, private readonly api: ProjectDeletionsResource, private readonly store: DeletionRequestStore,
    private readonly options: { key?: () => string; now?: () => number } = {}) {
    ProjectIdSchema.parse(projectId);
    try {
      const raw = store.read(projectId);
      if (raw !== undefined) {
        if (!raw || typeof raw !== 'object' || !('projectId' in raw) || raw.projectId !== projectId || !('input' in raw) || !('digest' in raw)) throw new Error('Invalid retained request');
        const operationId = 'operationId' in raw && raw.operationId !== undefined ? ResourceIdSchema.parse(raw.operationId) : undefined;
        this.pending = { projectId, input: AcceptProjectDeletionSchema.parse(raw.input), digest: ProjectDeletionDigestSchema.parse(raw.digest), ...(operationId ? { operationId } : {}) };
        this.state = { loading: false, pending: true };
      }
    } catch { this.state = { loading: false, pending: true, error: 'invalid-retained-request' }; }
  }
  getSnapshot = (): DeletionSessionState => this.state;
  hasRetainedRequest = (): boolean => this.pending !== undefined;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<DeletionSessionState>): void { this.state = { ...this.state, ...value }; for (const listener of this.listeners) listener(); }
  private original(raw: ProjectDeletionOperation): ProjectDeletionOperation {
    const operation = ProjectDeletionOperationSchema.parse(raw);
    if (operation.project.id !== this.projectId || this.state.operation && operation.id !== this.state.operation.id
      || this.pending?.operationId && operation.id !== this.pending.operationId) throw new Error('Original operation changed');
    return operation;
  }
  private accepted(operation: ProjectDeletionOperation): void {
    const previous = this.pending;
    this.pending = undefined; this.update({ operation, plan: undefined, pending: false, error: undefined });
    try {
      const stored = this.store.read(this.projectId);
      if (previous && stored && typeof stored === 'object' && 'projectId' in stored && stored.projectId === this.projectId && 'input' in stored
        && AcceptProjectDeletionSchema.safeParse(stored.input).data?.requestKey === previous.input.requestKey) this.store.write(this.projectId, undefined);
    } catch { /* Keep a retained key rather than erase another session's request; the server receipt remains authoritative. */ }
  }
  private receiptMatches(request: PendingDeletionRequest, operation: ProjectDeletionOperation): boolean {
    return operation.confirmations ? operation.confirmations.some((confirmation) => confirmation.requestKey === request.input.requestKey && confirmation.planId === request.input.planId && confirmation.digest === request.digest)
      : operation.confirmationDigest === request.digest;
  }
  private requestObserved(operation: ProjectDeletionOperation): boolean {
    return !this.pending?.operationId || operation.state === 'succeeded' || this.receiptMatches(this.pending, operation);
  }
  private async read(): Promise<ProjectDeletionOperation | undefined> {
    const found = await this.api.find(this.projectId);
    if (!found) {
      if (this.state.operation) throw new Error('Original operation disappeared');
      return undefined;
    }
    const operation = this.original(found);
    const plan = this.state.plan;
    const reviewingOriginal = !this.pending && plan?.operationId === operation.id && plan.supersedes === operation.confirmationDigest
      && operation.state === 'needs-attention' && operation.phase === 'seal';
    if (this.requestObserved(operation) && !reviewingOriginal) this.accepted(operation); else this.update({ operation });
    return operation;
  }
  async open(): Promise<void> {
    if (this.state.loading) return;
    this.update({ loading: true, error: undefined });
    try {
      const operation = await this.read();
      if (!operation && !this.state.pending && !this.state.plan) await this.prepare();
      else if (this.state.pending) this.update({ error: this.pending ? 'request-unknown' : 'invalid-retained-request' });
    } catch { this.update({ error: 'read-failed' }); }
    finally { this.update({ loading: false }); }
  }
  async refresh(): Promise<void> {
    if (this.state.loading) return;
    this.update({ loading: true, error: undefined });
    try { await this.read(); if (this.state.pending) this.update({ error: this.pending ? 'request-unknown' : 'invalid-retained-request' }); }
    catch { this.update({ error: 'read-failed' }); }
    finally { this.update({ loading: false }); }
  }
  private async prepare(): Promise<void> {
    const operation = this.state.operation;
    const plan = ProjectDeletionPlanSchema.parse(await (operation ? this.api.prepareReconfirmation(operation.id) : this.api.prepare(this.projectId)));
    if (plan.target.id !== this.projectId || (operation ? plan.operationId !== operation.id || plan.supersedes !== operation.confirmationDigest : plan.operationId !== undefined)) throw new Error('Wrong original plan');
    this.update({ plan, error: undefined });
  }
  async review(): Promise<void> {
    if (this.state.loading || this.state.pending || this.state.operation && this.state.operation.state !== 'needs-attention') return;
    this.update({ loading: true, error: undefined });
    try { await this.read(); if (!this.state.pending && (!this.state.operation || this.state.operation.state === 'needs-attention')) await this.prepare(); }
    catch { this.update({ error: 'read-failed' }); }
    finally { this.update({ loading: false }); }
  }
  async confirm(plan: ProjectDeletionPlan): Promise<void> {
    if (this.state.loading || this.state.pending) return;
    const current = this.state.plan;
    if (!current || plan.id !== current.id || plan.digest !== current.digest || !deletionPlanReady(current, this.projectId, (this.options.now ?? Date.now)())) { this.update({ error: 'plan-invalid' }); return; }
    let request: PendingDeletionRequest;
    try {
      request = { projectId: this.projectId, input: AcceptProjectDeletionSchema.parse({ planId: current.id, requestKey: (this.options.key ?? requestKey)(), confirm: 'delete' }), digest: current.digest,
        ...(current.operationId ? { operationId: current.operationId } : {}) };
      this.store.write(this.projectId, request);
    } catch { this.update({ error: 'cannot-retain-request' }); return; }
    this.pending = request; this.update({ pending: true, loading: true, plan: undefined, error: undefined });
    try { await this.sendRetained(); }
    catch (error) { await this.rejectedOrUnknown(error); }
    finally { this.update({ loading: false }); }
  }
  private async sendRetained(): Promise<void> {
    const request = this.pending!;
    const operation = this.original(await (request.operationId ? this.api.reconfirm(request.operationId, request.input) : this.api.accept(this.projectId, request.input)));
    if (!this.receiptMatches(request, operation)) throw new Error('Confirmation receipt not observed');
    this.accepted(operation);
  }
  private async rejectedOrUnknown(error: unknown): Promise<void> {
    const request = this.pending;
    try {
      if (!request || !isApiClientError(error) || !(error.status === 409 && error.kind === 'conflict' || error.status === 412 && error.kind === 'precondition')
        || error.details.code !== 'project_deletion_confirmation_rejected' || error.details.planId !== request.input.planId || error.details.requestKey !== request.input.requestKey) throw error;
      const operation = await this.read();
      if (!this.pending) return;
      if (operation && (operation.id !== request.operationId || operation.state !== 'needs-attention' || operation.phase !== 'seal')) throw error;
      const stored = this.store.read(this.projectId);
      if (!stored || typeof stored !== 'object' || !('projectId' in stored) || stored.projectId !== this.projectId || !('input' in stored) || !('digest' in stored)
        || stored.digest !== request.digest || AcceptProjectDeletionSchema.safeParse(stored.input).data?.requestKey !== request.input.requestKey
        || AcceptProjectDeletionSchema.safeParse(stored.input).data?.planId !== request.input.planId) throw error;
      this.store.write(this.projectId, undefined); this.pending = undefined;
      this.update({ pending: false, plan: undefined, error: 'plan-invalid' });
    } catch { this.update({ error: 'request-unknown' }); }
  }
  async recover(): Promise<void> {
    if (this.state.loading || !this.pending) return;
    this.update({ loading: true, error: undefined });
    try { await this.read(); if (this.pending) await this.sendRetained(); }
    catch (error) { await this.rejectedOrUnknown(error); }
    finally { this.update({ loading: false }); }
  }
  async retry(): Promise<void> {
    const operation = this.state.operation;
    if (this.state.loading || this.state.pending || !operation?.canRetry) return;
    this.update({ loading: true, error: undefined });
    try { this.accepted(this.original(await this.api.retry(operation.id))); }
    catch { this.update({ error: 'read-failed' }); }
    finally { this.update({ loading: false }); }
  }
}

function requestKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); let timestamp = BigInt(Date.now());
  for (let index = 5; index >= 0; index--) { bytes[index] = Number(timestamp & 255n); timestamp >>= 8n; }
  bytes[6] = (bytes[6]! & 15) | 112; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
