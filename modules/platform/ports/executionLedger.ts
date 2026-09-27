import type { ResourceCondition, ResourceKind, ResourceOwner, ResourcePhase } from '@crewstation/contracts';

/** 组合根接入执行记录所需的最小台账能力。 */
interface ExecutionRecord {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly purpose?: string;
  readonly owner: ResourceOwner;
  readonly desired: 'present' | 'absent';
  readonly conditions: readonly ResourceCondition[];
  readonly phase: ResourcePhase;
}

export interface ExecutionLedger {
  get(id: string): Promise<ExecutionRecord | undefined>;
  list(filter: { parentId: string; kind: 'agent-execution'; includeStopped: true }): Promise<readonly ExecutionRecord[]>;
  owner(module: string): {
    report(id: string, report: { conditions: readonly { type: string; status: 'true' | 'false'; reason: string; message: string }[] }): Promise<unknown>;
  };
}
