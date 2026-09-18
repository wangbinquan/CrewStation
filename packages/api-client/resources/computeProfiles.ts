import type {
  ComputeProfileDetailDto, ComputeProfileList, CopyComputeProfileRequest, CreateComputeProfileInput, ProfileTestDto, RegistryPushCredential, RuntimeImagesInfo,
  SaveComputeProfileInput, StartProfileTestRequest,
} from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import { segment } from '../requestUrl';

/** 算力档位管理（RFC-006）：全部只对管理员开放；任何响应都不含凭据原值。租户下拉用 catalog.listComputeProfiles。 */
export interface ComputeProfilesResource {
  /** GET /v1/admin/compute-profiles */
  list(): Promise<ComputeProfileList>;
  /** POST /v1/admin/compute-profiles（201）：建档并自动排一次测试。 */
  create(input: CreateComputeProfileInput): Promise<ComputeProfileDetailDto>;
  /** GET /v1/admin/compute-profiles/:name */
  get(name: string): Promise<ComputeProfileDetailDto>;
  /** PUT /v1/admin/compute-profiles/:name：expectedRevision 不符时 409，表单保留在客户端。 */
  save(name: string, input: SaveComputeProfileInput): Promise<ComputeProfileDetailDto>;
  /** PUT /v1/admin/compute-profiles/:name/enabled：默认档位不能停用（409）。 */
  setEnabled(name: string, enabled: boolean): Promise<ComputeProfileDetailDto>;
  /** PUT /v1/admin/compute-profiles/:name/default */
  setDefault(name: string): Promise<ComputeProfileDetailDto>;
  /** DELETE /v1/admin/compute-profiles/:name：被引用且未确认时 409，details 带项目清单。 */
  remove(name: string, options?: { confirmReferences?: boolean }): Promise<void>;
  /** POST /v1/admin/compute-profiles/:name/copy（201） */
  copy(name: string, input: CopyComputeProfileRequest): Promise<ComputeProfileDetailDto>;
  /** POST /v1/admin/compute-profiles/:name/tests（202）：同一 clientRequestId 只查回原测试。 */
  startTest(name: string, input: StartProfileTestRequest): Promise<ProfileTestDto>;
  /** GET /v1/admin/compute-profiles/:name/tests/:testId */
  getTest(name: string, testId: string): Promise<ProfileTestDto>;
  /** GET /v1/admin/runtime-images：推送地址、底座镜像与示例 Dockerfile。 */
  runtimeImages(): Promise<RuntimeImagesInfo>;
  /** POST /v1/admin/runtime-images/credentials：签发有期限的推送凭据，只在这次响应里出现。 */
  issuePushCredential(): Promise<RegistryPushCredential>;
}

export function computeProfilesResource(transport: Transport): ComputeProfilesResource {
  const base = '/v1/admin/compute-profiles';
  return {
    list: () => transport.request<ComputeProfileList>('GET', base),
    create: (input) => transport.request<ComputeProfileDetailDto>('POST', base, { body: input }),
    get: (name) => transport.request<ComputeProfileDetailDto>('GET', `${base}/${segment(name)}`),
    save: (name, input) => transport.request<ComputeProfileDetailDto>('PUT', `${base}/${segment(name)}`, { body: input }),
    setEnabled: (name, enabled) => transport.request<ComputeProfileDetailDto>('PUT', `${base}/${segment(name)}/enabled`, { body: { enabled } }),
    setDefault: (name) => transport.request<ComputeProfileDetailDto>('PUT', `${base}/${segment(name)}/default`, { body: {} }),
    remove: (name, options = {}) => transport.request<void>('DELETE', `${base}/${segment(name)}`, options.confirmReferences ? { query: { confirmReferences: 'true' } } : {}),
    copy: (name, input) => transport.request<ComputeProfileDetailDto>('POST', `${base}/${segment(name)}/copy`, { body: input }),
    startTest: (name, input) => transport.request<ProfileTestDto>('POST', `${base}/${segment(name)}/tests`, { body: input }),
    getTest: (name, testId) => transport.request<ProfileTestDto>('GET', `${base}/${segment(name)}/tests/${segment(testId)}`),
    runtimeImages: () => transport.request<RuntimeImagesInfo>('GET', '/v1/admin/runtime-images'),
    issuePushCredential: () => transport.request<RegistryPushCredential>('POST', '/v1/admin/runtime-images/credentials', { body: {} }),
  };
}
