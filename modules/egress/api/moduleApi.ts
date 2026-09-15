import type {
  Actor, AddEgressEntryRequest, BlockedEgressDto, DecideEgressRequest, EgressEntryDto, EgressPolicyDto, EgressRequestDto, EgressSource, ProjectId,
  RequestEgressEntryRequest, RequestPageQuery, EgressRequestPage, ForwardEgressHttpRequest,
} from '@crewstation/contracts';

/**
 * egress 模块对外能力（G23）：管理员维护全局出站白名单并可按项目开放；项目成员申请追加、查看被阻请求；
 * `policyFor` 与 `recordBlocked` 是控制面与出站代理使用的内部能力，不经 actor。
 */
export interface EgressModuleApi {
  readonly name: 'egress';
  addEntry(actor: Actor, input: AddEgressEntryRequest): Promise<EgressEntryDto>;
  removeEntry(actor: Actor, id: string): Promise<void>;
  /** 管理员不带 projectId 时看全部；带 projectId 时（成员亦可）看全局＋该项目条目。 */
  listEntries(actor: Actor, projectId?: ProjectId): Promise<EgressEntryDto[]>;
  requestEntry(actor: Actor, projectId: ProjectId, input: RequestEgressEntryRequest): Promise<EgressRequestDto>;
  /** 批准即在同一事务内生成项目级条目。 */
  decideRequest(actor: Actor, id: string, input: DecideEgressRequest): Promise<EgressRequestDto>;
  listRequests(actor: Actor, projectId?: ProjectId): Promise<EgressRequestDto[]>;
  listRequestPage(actor: Actor, query: RequestPageQuery): Promise<EgressRequestPage>;
  /** 全局＋项目级去重后的放行清单；供 task-runtime／控制面下发出站代理。 */
  policyFor(projectId: ProjectId): Promise<EgressPolicyDto>;
  /** 出站代理上报一次被阻请求：按 (project, fqdn) 累加。 */
  recordBlocked(projectId: ProjectId, fqdn: string, source?: EgressSource): Promise<BlockedEgressDto>;
  listBlocked(actor: Actor, projectId: ProjectId): Promise<BlockedEgressDto[]>;
  /** 来源由服务域网关注入；当前项目白名单决定每次代理 HTTP 出站。 */
  forwardHttp(sourceIdentity: string, input: ForwardEgressHttpRequest): Promise<Response>;
}
