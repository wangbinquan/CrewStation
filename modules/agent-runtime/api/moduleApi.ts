import type {
  ActivateRuntimeConfigRequest, Actor, AgentRuntimeMaterial, CreateRuntimeConfigRequest, DisableRuntimeConfigRequest, RuntimeCheckDto, RuntimeCheckId, RuntimeConfigDetailDto,
  RuntimeConfigId, RuntimeConfigListQuery, RuntimeConfigPage, RuntimeDriver, SaveRuntimeDraftRequest, StartRuntimeCheckRequest,
} from '@crewstation/contracts';

/** project 绑定校验与租户就绪投影所需的最小信息；不含步骤、变量或凭据。 */
export interface RuntimeConfigSummary {
  readonly id: string;
  readonly name: string;
  readonly driver: RuntimeDriver;
  readonly enabled: boolean;
  readonly activeRevision: number | null;
}

/**
 * agent-runtime 对外能力（RFC-004）。管理接口全部只对管理员开放；解析接口供 dev-session／business-task 经组合根使用，
 * 返回的材料含解密凭据，只能进受控 Runner 命令通道。
 */
export interface AgentRuntimeModuleApi {
  readonly name: 'agent-runtime';
  createConfig(actor: Actor, input: CreateRuntimeConfigRequest): Promise<RuntimeConfigDetailDto>;
  listConfigs(actor: Actor, query: RuntimeConfigListQuery): Promise<RuntimeConfigPage>;
  getConfig(actor: Actor, id: RuntimeConfigId): Promise<RuntimeConfigDetailDto>;
  saveDraft(actor: Actor, id: RuntimeConfigId, input: SaveRuntimeDraftRequest): Promise<RuntimeConfigDetailDto>;
  startCheck(actor: Actor, id: RuntimeConfigId, input: StartRuntimeCheckRequest): Promise<RuntimeCheckDto>;
  getCheck(actor: Actor, id: RuntimeConfigId, checkId: RuntimeCheckId): Promise<RuntimeCheckDto>;
  activate(actor: Actor, id: RuntimeConfigId, input: ActivateRuntimeConfigRequest): Promise<RuntimeConfigDetailDto>;
  disable(actor: Actor, id: RuntimeConfigId, input: DisableRuntimeConfigRequest): Promise<RuntimeConfigDetailDto>;
  describeConfig(id: string): Promise<RuntimeConfigSummary | undefined>;
  /** 新受理：已启用配置的已启用版本；未就绪抛 precondition，文案指向管理员。 */
  resolveActive(configId: string): Promise<AgentRuntimeMaterial>;
  /** 同一次受理的重试／重连：固定版本，不看当前最新。 */
  resolveRevision(configId: string, revision: number): Promise<AgentRuntimeMaterial>;
  /** 工作器入口：执行一条排队的检查。 */
  runQueuedCheck(checkId: RuntimeCheckId, heartbeat: () => Promise<boolean>): Promise<void>;
}
