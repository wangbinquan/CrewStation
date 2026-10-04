import { BusinessExecutionReceiptSchema, DevelopmentUsageLookupSchema, DevelopmentUsagePageSchema, ExecutionCompletionProofSchema, ProjectDeletionBusinessSourceSchema,
  ProjectDeletionSessionDataRequestSchema, ProjectDeletionSessionTasksRequestSchema, ProjectDeletionSessionTasksSchema, ProjectDeletionSessionTransportSchema, RunnerCommandSchema, RunnerResultPayloads,
  RunnerUsageMeasurementSchema, StoredBusinessExecutionSchema, StoredDevelopmentUsageSchema } from '@crewstation/contracts';
import type { DevelopmentUsagePage, ProjectDeletionContext, ProjectDeletionSessionData, ProjectDeletionSessionTransport, RunnerBusinessReceipt, RunnerCommand, RunnerUsageSourcePage, TaskId } from '@crewstation/contracts';
import { PlatformError, precondition } from '@crewstation/kernel';
import type { DevelopmentUsageSessionClient } from './developmentUsageClient';
import type { SessionClient } from './sessionClient';

type DeletionRequest = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ProjectDeletionSessionTask extends Pick<DevelopmentUsageSessionClient,
  'lookupDevelopmentUsage' | 'registerDevelopmentUsage' | 'getDevelopmentUsage' | 'requestDevelopmentUsageDrain'>,
  Pick<SessionClient, 'getBusinessExecution' | 'getExecutionCompletionProof' | 'listBusinessExecutionEvents' | 'consumeBusinessExecution'> {
  transports(): Promise<ProjectDeletionSessionTransport[]>;
  originalBusiness(after?: string | null): Promise<RunnerBusinessReceipt[]>;
  send(transport: ProjectDeletionSessionTransport, command: RunnerCommand): Promise<unknown>;
  offerDevelopment(key: Parameters<DevelopmentUsageSessionClient['getDevelopmentUsage']>[1]): Promise<DevelopmentUsagePage | null>;
  acknowledgeDevelopment(key: Parameters<DevelopmentUsageSessionClient['getDevelopmentUsage']>[1], through: number): Promise<void>;
  offerBusiness(executionId: string): Promise<RunnerUsageSourcePage | null>;
  acknowledgeBusiness(executionId: string, through: number): Promise<void>;
  data(operation: ProjectDeletionSessionData): Promise<unknown>;
}
/** This port is created only by the deletion coordinator. Ordinary callers keep the existing Session client. */
export function createProjectDeletionSessionClient(baseUrl: string, request: DeletionRequest = fetch) {
  const post = async (address: string, path: string, input: unknown) => {
    const response = await request(new URL(path, address), { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input), redirect: 'error', keepalive: false, signal: AbortSignal.timeout(30_000) });
    const body = await response.json() as { payload?: unknown; error?: PlatformError['kind']; message?: string; details?: Record<string, unknown> };
    if (!response.ok) throw new PlatformError(body.error ?? 'unavailable', body.message ?? '原 Session 数字清理未完成', body.details);
    return body.payload;
  };
  const task = (context: ProjectDeletionContext, taskId: TaskId): ProjectDeletionSessionTask => {
    const data = (operation: ProjectDeletionSessionData) => post(baseUrl, '/internal/project-deletion/data',
      ProjectDeletionSessionDataRequestSchema.parse({ context, taskId, operation }));
    const sameTask = (id: TaskId) => { if (id !== taskId) throw precondition('私有 Session 端口只能使用原任务'); };
    return {
      data,
      originalBusiness: async (after = null) => BusinessExecutionReceiptSchema.array().max(100).parse(await data({ type: 'business-originals', after })),
      transports: async () => {
        const values = ProjectDeletionSessionTransportSchema.array().parse(await data({ type: 'original-transports' }));
        if (values.some((value) => value.taskId !== taskId)) throw precondition('原连接来源返回了其他任务'); return values;
      },
      send: (raw, command) => {
        const transport = ProjectDeletionSessionTransportSchema.parse(raw); sameTask(transport.taskId);
        return post(transport.replica, '/internal/project-deletion/commands/' + transport.id, { context, command: RunnerCommandSchema.parse(command) });
      },
      lookupDevelopmentUsage: async (id) => { sameTask(id); return DevelopmentUsageLookupSchema.parse(await data({ type: 'development-lookup' })); },
      registerDevelopmentUsage: async (registration) => StoredDevelopmentUsageSchema.parse(await data({ type: 'development-existing', registration })),
      getDevelopmentUsage: async (id, key) => { sameTask(id); return StoredDevelopmentUsageSchema.parse(await data({ type: 'development-read', key })); },
      requestDevelopmentUsageDrain: async (id, key, reason) => { sameTask(id); return StoredDevelopmentUsageSchema.parse(await data({ type: 'development-drain', key, reason })); },
      getBusinessExecution: async (id, executionId) => { sameTask(id); return StoredBusinessExecutionSchema.parse(await data({ type: 'business-read', executionId })); },
      listBusinessExecutionEvents: async (id, executionId, after = 0, limit = 200) => {
        sameTask(id); return RunnerResultPayloads.businessExecutionEvents.parse(await data({ type: 'business-events', executionId, after, limit }));
      },
      getExecutionCompletionProof: async (id, executionId) => { sameTask(id); return ExecutionCompletionProofSchema.parse(await data({ type: 'business-completion', executionId })); },
      consumeBusinessExecution: async (id, executionId, through, stopped = false) => {
        sameTask(id); if (stopped) throw precondition('数字消费不能代替原容器停止证明');
        await data({ type: 'business-consume', executionId, through, stopped: false });
      },
      offerDevelopment: async (key) => DevelopmentUsagePageSchema.nullable().parse(await data({ type: 'development-source', key })),
      acknowledgeDevelopment: async (key, through) => { await data({ type: 'development-source-ack', key, through }); },
      offerBusiness: async (executionId) => ProjectDeletionBusinessSourceSchema.nullable().parse(await data({ type: 'business-source', executionId })),
      acknowledgeBusiness: async (executionId, through) => { await data({ type: 'business-source-ack', executionId, through }); },
    };
  };
  return Object.assign(task, { tasks: async (context: ProjectDeletionContext, after: TaskId | null = null): Promise<TaskId[]> =>
    ProjectDeletionSessionTasksSchema.parse(await post(baseUrl, '/internal/project-deletion/tasks', ProjectDeletionSessionTasksRequestSchema.parse({ context, after }))) });
}
export const projectDeletionMeasurement = (value: unknown) => RunnerUsageMeasurementSchema.nullable().parse(value);
