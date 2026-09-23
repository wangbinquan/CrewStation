import type {
  BranchDto, ExitMaintenanceRequest, ListBranchesQuery, MaintenanceDto, ManifestUpgradePreview, PostponeOfflineRequest, RedeployRequest, ReleaseDto, RepositoryBindingDto,
  ServiceDto, ServiceMaintenanceView, SetMaintenanceRequest, SlotDto, SlotEventDto, TagDto, TakeOfflineRequest, TrafficSwitchDto, TrafficSwitchRequest,
} from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import type { PublishInput } from '../requestInputs';
import { segment } from '../requestUrl';

/** 服务视角：仓库、分支与标签（scm）、Release、两个部署槽与切流（release）。 */
export interface ServicesResource {
  /** GET /v1/services/:serviceId */
  get(serviceId: string): Promise<ServiceDto>;
  /** GET /v1/services/:serviceId/repository */
  getRepository(serviceId: string): Promise<RepositoryBindingDto>;
  previewManifestUpgrade(serviceId: string, content: string): Promise<ManifestUpgradePreview>;
  /** GET /v1/services/:serviceId/branches?previewSha&prodSha：给出两槽提交时服务端计算落后数。 */
  listBranches(serviceId: string, query?: ListBranchesQuery): Promise<ItemsPage<BranchDto>>;
  /** GET /v1/services/:serviceId/tags */
  listTags(serviceId: string): Promise<ItemsPage<TagDto>>;
  /** GET /v1/services/:serviceId/releases */
  listReleases(serviceId: string): Promise<ItemsPage<ReleaseDto>>;
  /** POST /v1/services/:serviceId/releases（202）：平台打标签、构建、迁移并部署到待机槽。 */
  publish(serviceId: string, input: PublishInput): Promise<ReleaseDto>;
  /** GET /v1/releases/:releaseId */
  getRelease(releaseId: string): Promise<ReleaseDto>;
  /** GET /v1/services/:serviceId/slots：preview 与 prod 两个槽的当前状态。 */
  listSlots(serviceId: string): Promise<ItemsPage<SlotDto>>;
  /** POST /v1/services/:serviceId/traffic-switch（负责人）：切流或回退；expectedActiveRelease 不一致时拒绝。 */
  switchTraffic(serviceId: string, input: TrafficSwitchRequest): Promise<TrafficSwitchDto>;
  /** GET /v1/services/:serviceId/traffic-switches */
  listTrafficSwitches(serviceId: string): Promise<ItemsPage<TrafficSwitchDto>>;
  /** RFC-021 POST /v1/services/:serviceId/slots/preview/offline（负责人、管理员）：下线待验证版本，返回两个槽。 */
  takeOffline(serviceId: string, input: TakeOfflineRequest): Promise<ItemsPage<SlotDto>>;
  /** RFC-021 POST /v1/services/:serviceId/slots/preview/postpone（负责人、管理员）：自动下线推迟一个周期。 */
  postponeOffline(serviceId: string, input: PostponeOfflineRequest): Promise<ItemsPage<SlotDto>>;
  /** RFC-021 POST /v1/releases/:releaseId/redeploy（202，负责人、管理员）：从发布记录重新部署到待命槽。 */
  redeploy(releaseId: string, input: RedeployRequest): Promise<ReleaseDto>;
  /** RFC-021 GET /v1/services/:serviceId/slot-events：下线、重新部署、推迟、提醒记录。 */
  listSlotEvents(serviceId: string): Promise<ItemsPage<SlotEventDto>>;
  /** RFC-021 GET /v1/services/:serviceId/maintenance：当前维护与记录。 */
  getMaintenance(serviceId: string): Promise<ServiceMaintenanceView>;
  /** RFC-021 PUT /v1/services/:serviceId/maintenance（负责人、管理员）：进入或调整维护。 */
  setMaintenance(serviceId: string, input: SetMaintenanceRequest): Promise<MaintenanceDto>;
  /** RFC-021 POST /v1/services/:serviceId/maintenance/exit（负责人、管理员）：退出维护。 */
  exitMaintenance(serviceId: string, input: ExitMaintenanceRequest): Promise<ServiceMaintenanceView>;
}

export function servicesResource(transport: Transport): ServicesResource {
  const base = (serviceId: string) => `/v1/services/${segment(serviceId)}`;
  return {
    get: (serviceId) => transport.request<ServiceDto>('GET', base(serviceId)),
    getRepository: (serviceId) => transport.request<RepositoryBindingDto>('GET', `${base(serviceId)}/repository`),
    previewManifestUpgrade: (serviceId, content) => transport.request<ManifestUpgradePreview>('POST', `${base(serviceId)}/manifest-upgrade`, { body: { content } }),
    listBranches: (serviceId, query) => transport.request<ItemsPage<BranchDto>>('GET', `${base(serviceId)}/branches`, { query }),
    listTags: (serviceId) => transport.request<ItemsPage<TagDto>>('GET', `${base(serviceId)}/tags`),
    listReleases: (serviceId) => transport.request<ItemsPage<ReleaseDto>>('GET', `${base(serviceId)}/releases`),
    publish: (serviceId, input) => transport.request<ReleaseDto>('POST', `${base(serviceId)}/releases`, { body: input }),
    getRelease: (releaseId) => transport.request<ReleaseDto>('GET', `/v1/releases/${segment(releaseId)}`),
    listSlots: (serviceId) => transport.request<ItemsPage<SlotDto>>('GET', `${base(serviceId)}/slots`),
    switchTraffic: (serviceId, input) => transport.request<TrafficSwitchDto>('POST', `${base(serviceId)}/traffic-switch`, { body: input }),
    listTrafficSwitches: (serviceId) => transport.request<ItemsPage<TrafficSwitchDto>>('GET', `${base(serviceId)}/traffic-switches`),
    takeOffline: (serviceId, input) => transport.request<ItemsPage<SlotDto>>('POST', `${base(serviceId)}/slots/preview/offline`, { body: input }),
    postponeOffline: (serviceId, input) => transport.request<ItemsPage<SlotDto>>('POST', `${base(serviceId)}/slots/preview/postpone`, { body: input }),
    redeploy: (releaseId, input) => transport.request<ReleaseDto>('POST', `/v1/releases/${segment(releaseId)}/redeploy`, { body: input }),
    listSlotEvents: (serviceId) => transport.request<ItemsPage<SlotEventDto>>('GET', `${base(serviceId)}/slot-events`),
    getMaintenance: (serviceId) => transport.request<ServiceMaintenanceView>('GET', `${base(serviceId)}/maintenance`),
    setMaintenance: (serviceId, input) => transport.request<MaintenanceDto>('PUT', `${base(serviceId)}/maintenance`, { body: input }),
    exitMaintenance: (serviceId, input) => transport.request<ServiceMaintenanceView>('POST', `${base(serviceId)}/maintenance/exit`, { body: input }),
  };
}
