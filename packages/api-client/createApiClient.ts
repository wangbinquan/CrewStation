import type { TransportOptions } from './httpTransport';
import { createTransport } from './httpTransport';
import type { AgentRuntimeResource } from './resources/agentRuntime';
import { agentRuntimeResource } from './resources/agentRuntime';
import type { ApiCatalogResource } from './resources/apiCatalog';
import { apiCatalogResource } from './resources/apiCatalog';
import type { CapabilitiesResource } from './resources/capabilities';
import { capabilitiesResource } from './resources/capabilities';
import type { CatalogResource } from './resources/catalog';
import { catalogResource } from './resources/catalog';
import type { ConfigResource } from './resources/config';
import { configResource } from './resources/config';
import type { DevSessionResource } from './resources/devSession';
import { devSessionResource } from './resources/devSession';
import type { EgressResource } from './resources/egress';
import { egressResource } from './resources/egress';
import type { EventsResource } from './resources/events';
import { eventsResource } from './resources/events';
import type { GatewayResource } from './resources/gateway';
import { gatewayResource } from './resources/gateway';
import type { MeResource } from './resources/me';
import { meResource } from './resources/me';
import type { ObservabilityResource } from './resources/observability';
import { observabilityResource } from './resources/observability';
import type { ProjectsResource } from './resources/projects';
import { projectsResource } from './resources/projects';
import type { ServicesResource } from './resources/services';
import { servicesResource } from './resources/services';
import type { TasksResource } from './resources/tasks';
import { tasksResource } from './resources/tasks';
import type { UsersResource } from './resources/users';
import { usersResource } from './resources/users';
import { taskStreamUrl } from './stream';

export type ApiClientOptions = TransportOptions;

export interface TaskStreamResource {
  /** `/v1/tasks/:taskId/stream` 的 WebSocket 地址；baseUrl 为空时是同源相对路径。 */
  taskStreamUrl(taskId: string, sinceSeq?: number, replay?: 'tail'): string;
}

/** 按资源分组的平台 API 客户端；每个方法对应一条用户面路由。 */
export interface ApiClient {
  readonly baseUrl: string;
  readonly me: MeResource;
  readonly users: UsersResource;
  readonly projects: ProjectsResource;
  readonly catalog: CatalogResource;
  readonly services: ServicesResource;
  readonly devSession: DevSessionResource;
  readonly tasks: TasksResource;
  readonly config: ConfigResource;
  readonly egress: EgressResource;
  readonly apiCatalog: ApiCatalogResource;
  readonly events: EventsResource;
  readonly gateway: GatewayResource;
  readonly observability: ObservabilityResource;
  readonly capabilities: CapabilitiesResource;
  /** RFC-004：管理员运行环境。 */
  readonly agentRuntime: AgentRuntimeResource;
  readonly stream: TaskStreamResource;
}

/** 缺省同源（baseUrl ''）并携带 Cookie；CLI 与 MCP 传绝对 baseUrl 与自定义 fetch／headers。 */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const transport = createTransport(options);
  return {
    baseUrl: transport.baseUrl,
    me: meResource(transport),
    users: usersResource(transport),
    projects: projectsResource(transport),
    catalog: catalogResource(transport),
    services: servicesResource(transport),
    devSession: devSessionResource(transport),
    tasks: tasksResource(transport),
    config: configResource(transport),
    egress: egressResource(transport),
    apiCatalog: apiCatalogResource(transport),
    events: eventsResource(transport),
    gateway: gatewayResource(transport),
    observability: observabilityResource(transport),
    capabilities: capabilitiesResource(transport),
    agentRuntime: agentRuntimeResource(transport),
    stream: { taskStreamUrl: (taskId, sinceSeq = 0, replay) => taskStreamUrl(transport.baseUrl, taskId, sinceSeq, replay) },
  };
}
