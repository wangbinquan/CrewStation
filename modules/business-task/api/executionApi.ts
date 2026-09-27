import type { BusinessCapabilitiesDto, BusinessMigrationReady, BusinessSubtaskMessageV3, BusinessRecoveryClaim, BusinessRecoveryClaimReceipt, BusinessRecoveryRead, BusinessRecoveryReject, BusinessRecoveryRequest } from '@crewstation/contracts';
import type { BusinessMaterialRequest, BusinessMaterialDto } from '@crewstation/contracts';
import type { BusinessTaskMutation, RestartBusinessTask } from '@crewstation/contracts';
import type { BusinessSubtaskV3Dto, SubmitBusinessSubtaskV3, BusinessEventPage, BusinessEventQuery, BusinessOutputDto, BusinessOperationDto, BusinessSubtaskMutation, RetryBusinessSubtaskV3 } from '@crewstation/contracts';
import type { BusinessControlActivate, BusinessControlClaim, BusinessControlDto, BusinessControlLeaseRequest, BusinessHandoffReady, BusinessTaskV3Dto, CreateBusinessTaskV3, TaskId } from '@crewstation/contracts';
import type { BusinessDirectoryDto, BusinessDirectoryQuery, BusinessFileDto, BusinessFileQuery } from '@crewstation/contracts';

export interface BusinessExecutionCaller { identity: string; token?: string }
export interface BusinessExecutionApi {
  restartTask(caller: BusinessExecutionCaller, taskId: TaskId, input: RestartBusinessTask): Promise<{ task: BusinessTaskV3Dto; status: 200 | 201 | 202 }>;
  readRecovery(caller: BusinessExecutionCaller, id: string, input: BusinessRecoveryRead): Promise<BusinessRecoveryRequest>;
  claimRecovery(caller: BusinessExecutionCaller, input: BusinessRecoveryClaim): Promise<BusinessRecoveryClaimReceipt | null>;
  rejectRecovery(caller: BusinessExecutionCaller, id: string, input: BusinessRecoveryReject): Promise<BusinessRecoveryRequest>;
  capabilities(caller: BusinessExecutionCaller): Promise<BusinessCapabilitiesDto>;
  sendMessage(caller: BusinessExecutionCaller, taskId: TaskId, subtaskId: string, input: BusinessSubtaskMessageV3): Promise<BusinessOperationDto>;
  createMaterial(caller: BusinessExecutionCaller, taskId: TaskId, input: BusinessMaterialRequest): Promise<BusinessMaterialDto>;
  mutateTask(caller: BusinessExecutionCaller, taskId: TaskId, action: 'pause' | 'resume' | 'close' | 'rebuild', input: BusinessTaskMutation): Promise<BusinessOperationDto>;
  getOperation(caller: BusinessExecutionCaller, taskId: TaskId, id: string): Promise<BusinessOperationDto>;
  retrySubtask(caller: BusinessExecutionCaller, taskId: TaskId, subtaskId: string, input: RetryBusinessSubtaskV3): Promise<{ subtask: BusinessSubtaskV3Dto; status: 200 | 201 | 202 }>;
  cancelSubtask(caller: BusinessExecutionCaller, taskId: TaskId, subtaskId: string, input: BusinessSubtaskMutation): Promise<BusinessOperationDto>;
  events(caller: BusinessExecutionCaller, taskId: TaskId, query: BusinessEventQuery): Promise<BusinessEventPage>;
  output(caller: BusinessExecutionCaller, taskId: TaskId, subtaskId: string): Promise<BusinessOutputDto>;
  submitSubtask(caller: BusinessExecutionCaller, taskId: TaskId, input: SubmitBusinessSubtaskV3): Promise<{ subtask: BusinessSubtaskV3Dto; status: 200 | 201 | 202 }>;
  getSubtask(caller: BusinessExecutionCaller, taskId: TaskId, id: string): Promise<BusinessSubtaskV3Dto>;
  listSubtasks(caller: BusinessExecutionCaller, taskId: TaskId): Promise<BusinessSubtaskV3Dto[]>;
  createTask(caller: BusinessExecutionCaller, input: CreateBusinessTaskV3, traceHeader?: string): Promise<{ task: BusinessTaskV3Dto; status: 200 | 201 | 202 }>;
  getTask(caller: BusinessExecutionCaller, taskId: TaskId): Promise<BusinessTaskV3Dto>;
  readFile(caller: BusinessExecutionCaller, taskId: TaskId, query: BusinessFileQuery): Promise<BusinessFileDto>;
  listFiles(caller: BusinessExecutionCaller, taskId: TaskId, query: BusinessDirectoryQuery): Promise<BusinessDirectoryDto>;
  migrationReady(caller: BusinessExecutionCaller, input: BusinessMigrationReady): Promise<BusinessControlDto>;
  control(caller: BusinessExecutionCaller): Promise<BusinessControlDto>;
  claim(caller: BusinessExecutionCaller, input: BusinessControlClaim): Promise<BusinessControlDto>;
  renew(caller: BusinessExecutionCaller, input: BusinessControlLeaseRequest): Promise<BusinessControlDto>;
  release(caller: BusinessExecutionCaller, input: BusinessControlLeaseRequest): Promise<BusinessControlDto>;
  activate(caller: BusinessExecutionCaller, input: BusinessControlActivate): Promise<BusinessControlDto>;
  handoffReady(caller: BusinessExecutionCaller, input: BusinessHandoffReady): Promise<BusinessControlDto>;
  /** 控制器调用；只推进已持久受理的意图，GET 查询不触发它。 */
  runOnce(): Promise<number>;
}
