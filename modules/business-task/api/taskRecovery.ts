import type { Actor, BusinessRecoveryAssessment, BusinessRecoveryRequest, BusinessRecoveryTaskDetail, RequestBusinessRecovery, SubtaskId, TaskId } from '@crewstation/contracts';

export interface BusinessTaskRecoveryApi {
  describeRecoveryTask(actor: Actor, taskId: TaskId): Promise<BusinessRecoveryTaskDetail>;
  assessTaskRecovery(actor: Actor, taskId: TaskId, subtaskId?: SubtaskId): Promise<BusinessRecoveryAssessment>;
  requestTaskRecovery(actor: Actor, taskId: TaskId, input: RequestBusinessRecovery): Promise<BusinessRecoveryRequest>;
  listTaskRecoveries(actor: Actor, taskId: TaskId): Promise<BusinessRecoveryRequest[]>;
}
