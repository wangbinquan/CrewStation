import type {
  Actor, ApiOperationDto, ApiProxyDto, ApiRequestDto, CreateApiRequest, DecideApiRequest, OpenPolicy, ProjectId, ServiceId, UserId,
} from '@crewstation/contracts';

/** 供 gateway 生成放行表：调用方已获 Grant 且仍在目录中活动的操作键，加上对所有调用方生效的默认开放键。 */
export interface GrantedOperations {
  readonly operations: string[];
  readonly defaultOpen: string[];
}

/** api-catalog 模块对外能力；其他模块经 ports 注入其中的子集。 */
export interface ApiCatalogModuleApi {
  readonly name: 'api-catalog';
  isAdmin(userId: UserId): Promise<boolean>;
  /** 目录中的活动操作；给出 serviceId 时附带该服务是否已可调（默认开放视为已授权），并要求对其项目有 view 权限。 */
  listOperations(actor: Actor, serviceId?: ServiceId): Promise<ApiOperationDto[]>;
  listProxies(actor: Actor): Promise<ApiProxyDto[]>;
  /** 管理员把操作标为默认开放（所有业务可调）或定向开放（业务申请、管理员审批）。 */
  setOpenPolicy(actor: Actor, operationKey: string, policy: OpenPolicy): Promise<ApiOperationDto>;
  /** 业务为自己的服务申请定向开放的操作；需要服务所属项目的 develop 权限。 */
  requestAccess(actor: Actor, serviceId: ServiceId, input: CreateApiRequest): Promise<ApiRequestDto>;
  /** 给出 projectId 时需要该项目 view 权限；不给出时只有管理员能看全部。 */
  listRequests(actor: Actor, projectId?: ProjectId): Promise<ApiRequestDto[]>;
  /** 管理员批准（落 Grant 并发布 api-catalog.grant-changed）或拒绝并给出理由。 */
  decideRequest(actor: Actor, requestId: string, input: DecideApiRequest): Promise<ApiRequestDto>;
  revokeGrant(actor: Actor, serviceId: ServiceId, operationKey: string): Promise<void>;
  /** 供 gateway 生成放行表；无 actor，按调用方服务身份 `<project>/<service>` 查询，未知身份得到空授权。 */
  grantedOperations(callerIdentity: string): Promise<GrantedOperations>;
  /** 按服务可调范围裁剪后的 OpenAPI 文档，servers 改写为服务域内部 API 地址 `http://api.<serviceDomain>/api/<proxy>`。 */
  prunedOpenApi(actor: Actor, serviceId: ServiceId, proxy: string): Promise<Record<string, unknown>>;
}
