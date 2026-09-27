import type {
  BusinessCapabilitiesDto, BusinessControlActivate, BusinessControlClaim, BusinessControlDto, BusinessControlLeaseRequest,
  BusinessDirectoryDto, BusinessDirectoryQueryInput, BusinessEventPage, BusinessEventQueryInput, BusinessFileDto, BusinessFileQueryInput,
  BusinessMigrationReady, BusinessHandoffReady, BusinessMaterialDto, BusinessMaterialRequestInput, BusinessOperationDto, BusinessOutputDto,
  BusinessSubtaskMessageV3Input, BusinessSubtaskMutationInput, BusinessSubtaskV3Dto, BusinessTaskMutationInput, BusinessTaskV3Dto,
  CreateBusinessTaskV3Input, RetryBusinessSubtaskV3Input, SubmitBusinessSubtaskV3Input,
} from '@crewstation/contracts';
import { IDENTITY_HEADERS } from '@crewstation/contracts';
import type { RequestOptions, TransportOptions } from './httpTransport';
import { createTransport } from './httpTransport';
import { buildUrl } from './requestUrl';

/** Service-domain client. Aborting HTTP observation never cancels an accepted execution. */
export interface BusinessExecutionClient {
  capabilities(): Promise<BusinessCapabilitiesDto>;
  create(input: CreateBusinessTaskV3Input): Promise<BusinessTaskV3Dto>;
  operation(taskId: string, operationId: string): Promise<BusinessOperationDto>;
  get(taskId: string): Promise<BusinessTaskV3Dto>;
  submit(taskId: string, input: SubmitBusinessSubtaskV3Input): Promise<BusinessSubtaskV3Dto>;
  subtasks(taskId: string): Promise<{ items: BusinessSubtaskV3Dto[] }>;
  subtask(taskId: string, subtaskId: string): Promise<BusinessSubtaskV3Dto>;
  output(taskId: string, subtaskId: string): Promise<BusinessOutputDto>;
  retry(taskId: string, subtaskId: string, input: RetryBusinessSubtaskV3Input): Promise<BusinessSubtaskV3Dto>;
  cancel(taskId: string, subtaskId: string, input: BusinessSubtaskMutationInput): Promise<BusinessOperationDto>;
  message(taskId: string, subtaskId: string, input: BusinessSubtaskMessageV3Input): Promise<BusinessOperationDto>;
  pause(taskId: string, input: BusinessTaskMutationInput): Promise<BusinessOperationDto>;
  resume(taskId: string, input: BusinessTaskMutationInput): Promise<BusinessOperationDto>;
  close(taskId: string, input: BusinessTaskMutationInput): Promise<BusinessOperationDto>;
  material(taskId: string, input: BusinessMaterialRequestInput): Promise<BusinessMaterialDto>;
  events(taskId: string, query?: BusinessEventQueryInput): Promise<BusinessEventPage>;
  eventStreamUrl(taskId: string, query?: Omit<BusinessEventQueryInput, 'limit'>): string;
  file(taskId: string, query: BusinessFileQueryInput): Promise<BusinessFileDto>;
  files(taskId: string, query?: BusinessDirectoryQueryInput): Promise<BusinessDirectoryDto>;
  control(): Promise<BusinessControlDto>;
  claim(input: BusinessControlClaim): Promise<BusinessControlDto>;
  renew(input: BusinessControlLeaseRequest): Promise<BusinessControlDto>;
  release(input: BusinessControlLeaseRequest): Promise<BusinessControlDto>;
  activate(input: BusinessControlActivate): Promise<BusinessControlDto>;
  migrationReady(input: BusinessMigrationReady): Promise<BusinessControlDto>;
  handoffReady(input: BusinessHandoffReady): Promise<BusinessControlDto>;
}

export function createBusinessExecutionClient(options: TransportOptions): BusinessExecutionClient {
  const transport = createTransport(options);
  const root = '/v3/business-tasks', control = '/v3/business-execution/control';
  const task = (id: string) => `${root}/${encodeURIComponent(id)}`;
  const subtask = (id: string, subtaskId: string) => `${task(id)}/subtasks/${encodeURIComponent(subtaskId)}`;
  const get = <T>(path: string, query?: RequestOptions['query']) => transport.request<T>('GET', path, { query });
  const post = <T>(path: string, body: unknown) => transport.request<T>('POST', path, { body });
  return {
    operation: (id, op) => get(`${task(id)}/operations/${encodeURIComponent(op)}`),
    capabilities: () => get('/v3/business-execution/capabilities'),
    create: (input) => transport.request('POST', root, { body: input, ...(input.traceId ? { headers: { [IDENTITY_HEADERS.traceId]: input.traceId } } : {}) }), get: (id) => get(task(id)),
    submit: (id, input) => post(`${task(id)}/subtasks`, input),
    subtasks: (id) => get(`${task(id)}/subtasks`), subtask: (id, sub) => get(subtask(id, sub)),
    output: (id, sub) => get(`${subtask(id, sub)}/output`),
    retry: (id, sub, input) => post(`${subtask(id, sub)}/retry`, input),
    cancel: (id, sub, input) => post(`${subtask(id, sub)}/cancel`, input),
    message: (id, sub, input) => post(`${subtask(id, sub)}/messages`, input),
    pause: (id, input) => post(`${task(id)}/pause`, input), resume: (id, input) => post(`${task(id)}/resume`, input), close: (id, input) => post(`${task(id)}/close`, input),
    material: (id, input) => post(`${task(id)}/materials`, input), events: (id, query) => get(`${task(id)}/events`, query),
    eventStreamUrl: (id, query) => buildUrl(transport.baseUrl, `${task(id)}/events/stream`, query),
    file: (id, query) => get(`${task(id)}/file`, query), files: (id, query) => get(`${task(id)}/files`, query),
    control: () => get(control), claim: (input) => post(`${control}/claim`, input), renew: (input) => post(`${control}/renew`, input),
    release: (input) => post(`${control}/release`, input), activate: (input) => post(`${control}/activate`, input),
    migrationReady: (input) => post(`${control}/migrations/${encodeURIComponent(input.operationId)}/ready`, input),
    handoffReady: (input) => post(`${control}/handoffs/${encodeURIComponent(input.operationId)}/ready`, input),
  };
}
