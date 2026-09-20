import type { AllowlistDocument, RouteEntry, ServiceId, WorkloadIdentity } from '@crewstation/contracts';

export interface EvaluationTarget { host: string; method: string; path: string }
export interface Evaluation { allowed: boolean; targetIdentity: string; reason?: string }

/** gateway 模块对外能力：路由与放行表生成、Pod 身份反查与服务域放行评估（cs-auth 用后两者）。 */
export interface GatewayModuleApi {
  readonly name: 'gateway';
  reconcileService(serviceId: ServiceId): Promise<RouteEntry[]>;
  reconcileAll(): Promise<number>;
  removeService(serviceId: ServiceId): Promise<void>;
  listRoutes(): Promise<Array<{ serviceId: string; serviceName: string; routes: RouteEntry[] }>>;
  rebuildAllowlist(): Promise<AllowlistDocument>;
  currentAllowlist(): Promise<AllowlistDocument | undefined>;
  evaluate(caller: WorkloadIdentity, target: EvaluationTarget): Promise<Evaluation>;
  lookupByIp(ip: string): Promise<WorkloadIdentity | undefined>;
}
