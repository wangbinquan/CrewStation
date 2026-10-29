import type { CreateDatabaseMigration, RetryDatabaseMigration, ApproveDatabaseMigration, SwitchDatabaseMigration, DatabaseMigrationDto } from '@crewstation/contracts';
import type { AbandonDatabaseRestore, CreateDatabaseRestore, RetryDatabaseRestore, SwitchDatabaseRestore, DatabaseRestoreDto, DatabaseGenerationList } from '@crewstation/contracts';
import type {
  BranchDto, ExitMaintenanceRequest, ListBranchesQuery, MaintenanceDto, ManifestUpgradePreview, PostponeOfflineRequest, RedeployPrecheckDto, RedeployRequest, ReleaseDto, RepositoryBindingDto,
  ServiceDto, ServiceMaintenanceView, SetMaintenanceRequest, SlotDto, SlotEventDto, TagDto, TakeOfflineRequest, TrafficSwitchDto, TrafficSwitchRequest,
} from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ReleaseJourneyDetail, ReleaseJourneyHistory, ReleaseJourneyPage, ReleaseJourneyPageRequest, VerifyReleaseJourneyRequest } from '@crewstation/contracts';
import type { ItemsPage } from '../itemsPage';
import type { PublishInput } from '../requestInputs';
import { segment } from '../requestUrl';

/** 服务视角：仓库、分支与标签（scm）、Release、两个部署槽与切流（release）。 */
export interface ServicesResource {
  listDatabaseMigrations(serviceId:string):Promise<{items:DatabaseMigrationDto[]}>;
  getDatabaseMigration(serviceId:string,id:string):Promise<DatabaseMigrationDto>;
  createDatabaseMigration(serviceId:string,input:CreateDatabaseMigration):Promise<DatabaseMigrationDto>;
  replanDatabaseMigration(serviceId:string,id:string,input:RetryDatabaseMigration):Promise<DatabaseMigrationDto>;
  approveDatabaseMigration(serviceId:string,id:string,input:ApproveDatabaseMigration):Promise<DatabaseMigrationDto>;
  switchDatabaseMigration(serviceId:string,id:string,input:SwitchDatabaseMigration):Promise<DatabaseMigrationDto>;
  openDatabaseMigration(serviceId:string,id:string,input:SwitchDatabaseMigration):Promise<DatabaseMigrationDto>;
  rollbackDatabaseMigration(serviceId:string,id:string,input:RetryDatabaseMigration):Promise<DatabaseMigrationDto>;
  cancelRollbackDatabaseMigration(serviceId:string,id:string,input:RetryDatabaseMigration):Promise<DatabaseMigrationDto>;
  retryDatabaseMigration(serviceId:string,id:string,input:RetryDatabaseMigration):Promise<DatabaseMigrationDto>;
  abandonDatabaseMigration(serviceId:string,id:string,input:RetryDatabaseMigration):Promise<DatabaseMigrationDto>;
  databaseMigrationPlanMarkdown(serviceId:string,id:string):Promise<{markdown:string}>;
  databaseGenerations(serviceId:string):Promise<DatabaseGenerationList>;
  listDatabaseRestores(serviceId:string):Promise<{items:DatabaseRestoreDto[]}>;
  getDatabaseRestore(serviceId:string,id:string):Promise<DatabaseRestoreDto>;
  createDatabaseRestore(serviceId:string,input:CreateDatabaseRestore):Promise<DatabaseRestoreDto>;
  retryDatabaseRestore(serviceId:string,id:string,input:RetryDatabaseRestore):Promise<DatabaseRestoreDto>;
  switchDatabaseRestore(serviceId:string,id:string,input:SwitchDatabaseRestore):Promise<DatabaseRestoreDto>;
  abandonDatabaseRestore(serviceId:string,id:string,input:AbandonDatabaseRestore):Promise<DatabaseRestoreDto>;
  listReleaseJourneys(serviceId: string, query?: Partial<ReleaseJourneyPageRequest>): Promise<ReleaseJourneyPage>;
  getReleaseJourney(journeyId: string): Promise<ReleaseJourneyDetail>;
  getReleaseJourneyHistory(releaseId: string): Promise<ReleaseJourneyHistory>;
  verifyReleaseJourney(journeyId: string, input: VerifyReleaseJourneyRequest): Promise<ReleaseJourneyDetail>;
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
  getExecutionHandoff(serviceId: string, operationId: string): Promise<TrafficSwitchDto>;
  latestExecutionHandoff(serviceId: string): Promise<TrafficSwitchDto | null>;
  /** GET /v1/services/:serviceId/traffic-switches */
  listTrafficSwitches(serviceId: string): Promise<ItemsPage<TrafficSwitchDto>>;
  /** RFC-021 POST /v1/services/:serviceId/slots/preview/offline（负责人、管理员）：下线待验证版本，返回两个槽。 */
  takeOffline(serviceId: string, input: TakeOfflineRequest): Promise<ItemsPage<SlotDto>>;
  /** RFC-021 POST /v1/services/:serviceId/slots/preview/postpone（负责人、管理员）：自动下线推迟一个周期。 */
  postponeOffline(serviceId: string, input: PostponeOfflineRequest): Promise<ItemsPage<SlotDto>>;
  /** RFC-021 POST /v1/releases/:releaseId/redeploy（202，负责人、管理员）：从发布记录重新部署到待命槽。 */
  redeploy(releaseId: string, input: RedeployRequest): Promise<ReleaseDto>;
  /** RFC-025 GET /v1/releases/:releaseId/redeploy-precheck（负责人、管理员）：重新部署的统一预检，不通过时带标准原因。 */
  redeployPrecheck(releaseId: string): Promise<RedeployPrecheckDto>;
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
    listDatabaseMigrations:id=>transport.request('GET',`${base(id)}/database-migrations`),
    getDatabaseMigration:(id,op)=>transport.request('GET',`${base(id)}/database-migrations/${segment(op)}`),
    createDatabaseMigration:(id,input)=>transport.request('POST',`${base(id)}/database-migrations`,{body:input}),
    databaseMigrationPlanMarkdown:(id,op)=>transport.request('GET',`${base(id)}/database-migrations/${segment(op)}/plan`),
    replanDatabaseMigration:(id,op,input)=>transport.request('POST',`${base(id)}/database-migrations/${segment(op)}/replan`,{body:input}),
    approveDatabaseMigration:(id,op,input)=>transport.request('POST',`${base(id)}/database-migrations/${segment(op)}/approve`,{body:input}),
    switchDatabaseMigration:(id,op,input)=>transport.request('POST',`${base(id)}/database-migrations/${segment(op)}/switch`,{body:input}),
    openDatabaseMigration:(id,op,input)=>transport.request('POST',`${base(id)}/database-migrations/${segment(op)}/open`,{body:input}),
    rollbackDatabaseMigration:(id,op,input)=>transport.request('POST',`${base(id)}/database-migrations/${segment(op)}/rollback`,{body:input}),
    cancelRollbackDatabaseMigration:(id,op,input)=>transport.request('POST',`${base(id)}/database-migrations/${segment(op)}/cancel-rollback`,{body:input}),
    retryDatabaseMigration:(id,op,input)=>transport.request('POST',`${base(id)}/database-migrations/${segment(op)}/retry`,{body:input}),
    abandonDatabaseMigration:(id,op,input)=>transport.request('POST',`${base(id)}/database-migrations/${segment(op)}/abandon`,{body:input}),
    databaseGenerations:id=>transport.request('GET',`${base(id)}/database-generations`),
    listDatabaseRestores:id=>transport.request('GET',`${base(id)}/database-restores`),
    getDatabaseRestore:(id,op)=>transport.request('GET',`${base(id)}/database-restores/${segment(op)}`),
    createDatabaseRestore:(id,input)=>transport.request('POST',`${base(id)}/database-restores`,{body:input}),
    retryDatabaseRestore:(id,op,input)=>transport.request('POST',`${base(id)}/database-restores/${segment(op)}/retry`,{body:input}),
    switchDatabaseRestore:(id,op,input)=>transport.request('POST',`${base(id)}/database-restores/${segment(op)}/switch`,{body:input}),
    abandonDatabaseRestore:(id,op,input)=>transport.request('POST',`${base(id)}/database-restores/${segment(op)}/abandon`,{body:input}),
    listReleaseJourneys: (serviceId, query) => transport.request<ReleaseJourneyPage>('GET', `${base(serviceId)}/release-journeys`, { query }),
    getReleaseJourney: (id) => transport.request<ReleaseJourneyDetail>('GET', `/v1/release-journeys/${segment(id)}`),
    getReleaseJourneyHistory: (id) => transport.request<ReleaseJourneyHistory>('GET', `/v1/releases/${segment(id)}/journey-history`),
    verifyReleaseJourney: (id, input) => transport.request<ReleaseJourneyDetail>('POST', `/v1/release-journeys/${segment(id)}/verification`, { body: input }),
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
    getExecutionHandoff: (serviceId, operationId) => transport.request<TrafficSwitchDto>('GET', `${base(serviceId)}/execution-handoffs/${segment(operationId)}`),
    latestExecutionHandoff: (serviceId) => transport.request<TrafficSwitchDto | null>('GET', `${base(serviceId)}/execution-handoff`),
    listTrafficSwitches: (serviceId) => transport.request<ItemsPage<TrafficSwitchDto>>('GET', `${base(serviceId)}/traffic-switches`),
    takeOffline: (serviceId, input) => transport.request<ItemsPage<SlotDto>>('POST', `${base(serviceId)}/slots/preview/offline`, { body: input }),
    postponeOffline: (serviceId, input) => transport.request<ItemsPage<SlotDto>>('POST', `${base(serviceId)}/slots/preview/postpone`, { body: input }),
    redeploy: (releaseId, input) => transport.request<ReleaseDto>('POST', `/v1/releases/${segment(releaseId)}/redeploy`, { body: input }),
    redeployPrecheck: (releaseId) => transport.request<RedeployPrecheckDto>('GET', `/v1/releases/${segment(releaseId)}/redeploy-precheck`),
    listSlotEvents: (serviceId) => transport.request<ItemsPage<SlotEventDto>>('GET', `${base(serviceId)}/slot-events`),
    getMaintenance: (serviceId) => transport.request<ServiceMaintenanceView>('GET', `${base(serviceId)}/maintenance`),
    setMaintenance: (serviceId, input) => transport.request<MaintenanceDto>('PUT', `${base(serviceId)}/maintenance`, { body: input }),
    exitMaintenance: (serviceId, input) => transport.request<ServiceMaintenanceView>('POST', `${base(serviceId)}/maintenance/exit`, { body: input }),
  };
}
