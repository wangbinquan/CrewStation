import type {
  CreateProjectRequest, ListDeliveriesQuery, LogQuery, PublishRequest, RequestTaskDataBinding, ServicePlanDto, SetConfigItemRequest,
  PublishDevSessionRequest, StartDevAgentRequest, TaskProfileDto,
} from '@crewstation/contracts';

/**
 * contracts 导出的是 zod 解析后的输出类型：带 `.default()` 的字段在其中是必填的。
 * 客户端发送前不做解析，因此把这些字段改回可选，服务端按 Schema 补默认值。
 */
export type WithDefaults<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type CreateProjectInput = WithDefaults<CreateProjectRequest, 'kind' | 'template'>;
export type PublishInput = WithDefaults<PublishRequest, 'version'>;
export type PublishDevSessionInput = WithDefaults<PublishDevSessionRequest, 'version'>;
export type StartDevAgentInput = WithDefaults<StartDevAgentRequest, 'permission'>;
/** 路径已带 env，请求体里的 env 由客户端按路径补齐。 */
export type SetConfigItemInput = WithDefaults<Omit<SetConfigItemRequest, 'env'>, 'isSecret'>;
export type RequestTaskDataBindingInput = WithDefaults<RequestTaskDataBinding, 'ttlMinutes'>;
export type ListDeliveriesInput = Partial<ListDeliveriesQuery>;
export type LogQueryInput = WithDefaults<LogQuery, 'limit'>;
export type ServicePlanInput = WithDefaults<ServicePlanDto, 'description'>;
export type TaskProfileInput = WithDefaults<TaskProfileDto, 'description'>;
