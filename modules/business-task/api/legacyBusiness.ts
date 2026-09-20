import type { BusinessTaskDto, CreateBusinessTaskRequest, LegacyBusinessTaskDto, LegacyCreateBusinessTaskRequest, LegacySubmitSubtaskRequest, LegacySubtaskDto, SubmitSubtaskRequest, SubtaskDto, SubtaskId, TaskId } from '@crewstation/contracts';

export interface LegacyBusinessProjection {
  taskId(id: string): Promise<TaskId>;
  subtaskId(id: string): Promise<SubtaskId>;
  inputTask(input: LegacyCreateBusinessTaskRequest): Promise<CreateBusinessTaskRequest>;
  inputSubtask(input: LegacySubmitSubtaskRequest, serviceId: string): Promise<SubmitSubtaskRequest>;
  task(value: BusinessTaskDto): Promise<LegacyBusinessTaskDto>;
  subtask(value: SubtaskDto, serviceId: string): Promise<LegacySubtaskDto>;
}
