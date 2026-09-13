import type { AppPresentationDto, AppVisibilityCheckDto, AppVisibilityDto, ManifestKind, MemberCandidateDto, MemberDto, ProjectDto, QuotaDto, SetAppPresentationRequest, SetAppVisibilityRequest, SetMemberRequest, SetQuotaRequest } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { ItemsPage } from '../itemsPage';
import type { CreateProjectInput } from '../requestInputs';
import { segment } from '../requestUrl';

export interface ProjectsResource {
  /**
   * GET /v1/projects：管理员看全部，成员看自己所在的项目。
   * `kinds` 在作用域之后再筛一层（RFC-002）：租户空间传 `['DigitalWorker']`，
   * 管理空间的接入容器页传 `['APIProxy', 'EventProducer']`；省略即不筛。
   */
  list(kinds?: readonly ManifestKind[]): Promise<ItemsPage<ProjectDto>>;
  /** POST /v1/projects（管理员代建并指定负责人）。 */
  create(input: CreateProjectInput): Promise<ProjectDto>;
  /** GET /v1/projects/:projectId */
  get(projectId: string): Promise<ProjectDto>;
  /** POST /v1/projects/:projectId/archive */
  archive(projectId: string): Promise<ProjectDto>;
  /** GET /v1/projects/:projectId/members */
  listMembers(projectId: string): Promise<ItemsPage<MemberDto>>;
  /** PUT /v1/projects/:projectId/members：新增或改角色。 */
  setMember(projectId: string, input: SetMemberRequest): Promise<MemberDto>;
  /** DELETE /v1/projects/:projectId/members/:userId */
  removeMember(projectId: string, userId: string): Promise<void>;
  /** GET /v1/projects/:projectId/quota */
  getQuota(projectId: string): Promise<QuotaDto>;
  /** PUT /v1/projects/:projectId/quota */
  setQuota(projectId: string, input: SetQuotaRequest): Promise<QuotaDto>;
  memberCandidates(projectId: string, identity: string): Promise<ItemsPage<MemberCandidateDto>>;
  getAppVisibility(projectId: string): Promise<AppVisibilityDto>;
  setAppVisibility(projectId: string, input: SetAppVisibilityRequest): Promise<AppVisibilityDto>;
  checkAppVisibility(projectId: string, userId: string): Promise<AppVisibilityCheckDto>;
  getAppPresentation(projectId: string): Promise<AppPresentationDto>;
  setAppPresentation(projectId: string, input: SetAppPresentationRequest): Promise<AppPresentationDto>;
}

export function projectsResource(transport: Transport): ProjectsResource {
  const base = (projectId: string) => `/v1/projects/${segment(projectId)}`;
  return {
    list: (kinds) => transport.request<ItemsPage<ProjectDto>>('GET', '/v1/projects', kinds === undefined ? {} : { query: { kind: kinds.join(',') } }),
    create: (input) => transport.request<ProjectDto>('POST', '/v1/projects', { body: input }),
    get: (projectId) => transport.request<ProjectDto>('GET', base(projectId)),
    archive: (projectId) => transport.request<ProjectDto>('POST', `${base(projectId)}/archive`),
    listMembers: (projectId) => transport.request<ItemsPage<MemberDto>>('GET', `${base(projectId)}/members`),
    setMember: (projectId, input) => transport.request<MemberDto>('PUT', `${base(projectId)}/members`, { body: input }),
    removeMember: (projectId, userId) => transport.request<void>('DELETE', `${base(projectId)}/members/${segment(userId)}`),
    getQuota: (projectId) => transport.request<QuotaDto>('GET', `${base(projectId)}/quota`),
    setQuota: (projectId, input) => transport.request<QuotaDto>('PUT', `${base(projectId)}/quota`, { body: input }),
    memberCandidates: (id, identity) => transport.request('GET', `${base(id)}/member-candidates`, { query: { identity } }),
    getAppVisibility: (id) => transport.request('GET', `${base(id)}/app-visibility`),
    setAppVisibility: (id, input) => transport.request('PUT', `${base(id)}/app-visibility`, { body: input }),
    checkAppVisibility: (id, userId) => transport.request('GET', `${base(id)}/app-visibility/check`, { query: { userId } }),
    getAppPresentation: (id) => transport.request('GET', `${base(id)}/app-presentation`),
    setAppPresentation: (id, input) => transport.request('PUT', `${base(id)}/app-presentation`, { body: input }),
  };
}
