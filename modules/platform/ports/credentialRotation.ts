import type { ProjectId } from '@crewstation/contracts';

/** 组合根的口令轮换协作端口；事务同时覆盖密文与资源条件。 */
export interface RotationLedger {
  withIdleProject<T>(projectId: ProjectId, fn: (tx: object) => Promise<T>): Promise<T>;
  owner(module: string): { within(tx: object): { report(id: string, report: { conditions: { type: string; status: 'true' | 'false'; reason?: string; message?: string }[] }): Promise<unknown> } };
}
export interface RotationControl {
  stageRotation(id: string, transaction: object): Promise<void>;
  finishRotation(id: string, transaction: object): Promise<void>;
}
