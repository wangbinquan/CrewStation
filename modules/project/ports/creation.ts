import type { ProjectTemplateDto, UserId } from '@crewstation/contracts';

export interface CreationTemplates { list(): Promise<ProjectTemplateDto[]> }
export interface RoleMutationLock { run<T>(userId: UserId, work: () => Promise<T>): Promise<T> }
