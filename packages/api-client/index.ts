// 手写的类型化平台 API 客户端；console、cli、mcp-* 共用。唯一公开入口，其余文件不直接 import。
export { createApiClient } from './createApiClient';
export type { ApiClient, ApiClientOptions, TaskStreamResource } from './createApiClient';
export { ApiClientError, isApiClientError, kindForStatus, parseErrorEnvelope } from './apiClientError';
export type { ApiErrorKind } from './apiClientError';
export type { FetchInput, FetchLike, HttpMethod, RequestOptions, Transport, TransportOptions } from './httpTransport';
export type { ItemsPage } from './itemsPage';
export type {
  CreateProjectInput, ListDeliveriesInput, LogQueryInput, PublishDevSessionInput, PublishInput, RequestTaskDataBindingInput, ServicePlanInput, SetConfigItemInput,
  TaskProfileInput, WithDefaults,
} from './requestInputs';
export { parseTaskStreamFrame, taskStreamUrl } from './stream';
export type {
  ListFilesResult, PreviewStatusResult, ReadFileResult, TaskStreamCommand, TaskStreamCommandInput, TaskStreamErrorFrame, TaskStreamEventFrame,
  TaskStreamFrame, TaskStreamReadyFrame, TaskStreamResultFrame, WriteFileResult,
} from './stream';
export type { MeResource } from './resources/me';
export type { UsersResource } from './resources/users';
export type { ProjectsResource } from './resources/projects';
export type { CatalogResource } from './resources/catalog';
export type { ServicesResource } from './resources/services';
export type { DevSessionResource, ReleaseDevSessionOptions, ReleaseDevSessionResult } from './resources/devSession';
export type { TaskEnvironmentDto, TaskEnvironmentState, TasksResource } from './resources/tasks';
export type { ConfigResource } from './resources/config';
export type { ApiCatalogResource } from './resources/apiCatalog';
export type { EventsResource } from './resources/events';
export type { GatewayAllowlistDto, GatewayReconcileResult, GatewayResource, GatewayServiceRoutes } from './resources/gateway';
export type { ObservabilityResource } from './resources/observability';
export type { CapabilitiesResource } from './resources/capabilities';
export type { ComputeProfilesResource } from './resources/computeProfiles';
export type { ClusterResourceClient } from './resources/cluster';
export { newDraftResourceId } from './resourceId';
