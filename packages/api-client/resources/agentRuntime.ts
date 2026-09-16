import type { ActivateRuntimeConfigRequest, DisableRuntimeConfigRequest, RuntimeCheckDto, RuntimeConfigDetailDto, RuntimeConfigListQuery, RuntimeConfigPage, StartRuntimeCheckRequest } from '@crewstation/contracts';
import type { Transport } from '../httpTransport';
import type { CreateRuntimeConfigInput, SaveRuntimeDraftInput } from '../requestInputs';
import { segment } from '../requestUrl';

/** 管理员运行环境（RFC-004）：全部只对管理员开放；任何响应都不含凭据原值。 */
export interface AgentRuntimeResource {
  /** GET /v1/admin/agent-runtime-configs */
  listConfigs(query?: Partial<RuntimeConfigListQuery>): Promise<RuntimeConfigPage>;
  /** POST /v1/admin/agent-runtime-configs（201）：建草稿，不自动启用。 */
  createConfig(input: CreateRuntimeConfigInput): Promise<RuntimeConfigDetailDto>;
  /** GET /v1/admin/agent-runtime-configs/:id */
  getConfig(id: string): Promise<RuntimeConfigDetailDto>;
  /** PUT /v1/admin/agent-runtime-configs/:id/draft：expectedRevision 不符时 409，草稿保留在客户端。 */
  saveDraft(id: string, input: SaveRuntimeDraftInput): Promise<RuntimeConfigDetailDto>;
  /** POST /v1/admin/agent-runtime-configs/:id/checks（202）：同一 clientRequestId 只查回原检查。 */
  startCheck(id: string, input: StartRuntimeCheckRequest): Promise<RuntimeCheckDto>;
  /** GET /v1/admin/agent-runtime-configs/:id/checks/:checkId */
  getCheck(id: string, checkId: string): Promise<RuntimeCheckDto>;
  /** POST /v1/admin/agent-runtime-configs/:id/activate */
  activate(id: string, input: ActivateRuntimeConfigRequest): Promise<RuntimeConfigDetailDto>;
  /** POST /v1/admin/agent-runtime-configs/:id/disable */
  disable(id: string, input: DisableRuntimeConfigRequest): Promise<RuntimeConfigDetailDto>;
}

export function agentRuntimeResource(transport: Transport): AgentRuntimeResource {
  const base = '/v1/admin/agent-runtime-configs';
  return {
    listConfigs: (query = {}) => transport.request<RuntimeConfigPage>('GET', base, { query: Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) }),
    createConfig: (input) => transport.request<RuntimeConfigDetailDto>('POST', base, { body: input }),
    getConfig: (id) => transport.request<RuntimeConfigDetailDto>('GET', `${base}/${segment(id)}`),
    saveDraft: (id, input) => transport.request<RuntimeConfigDetailDto>('PUT', `${base}/${segment(id)}/draft`, { body: input }),
    startCheck: (id, input) => transport.request<RuntimeCheckDto>('POST', `${base}/${segment(id)}/checks`, { body: input }),
    getCheck: (id, checkId) => transport.request<RuntimeCheckDto>('GET', `${base}/${segment(id)}/checks/${segment(checkId)}`),
    activate: (id, input) => transport.request<RuntimeConfigDetailDto>('POST', `${base}/${segment(id)}/activate`, { body: input }),
    disable: (id, input) => transport.request<RuntimeConfigDetailDto>('POST', `${base}/${segment(id)}/disable`, { body: input }),
  };
}
