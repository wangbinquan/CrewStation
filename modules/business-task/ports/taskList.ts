import type { BusinessExecutionTaskPage, BusinessExecutionTaskQuery } from '@crewstation/contracts';
export interface BusinessTaskList { list(query: BusinessExecutionTaskQuery): Promise<BusinessExecutionTaskPage> }
