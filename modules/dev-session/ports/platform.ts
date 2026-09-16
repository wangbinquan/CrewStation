import type { Actor, AgentDriver, AgentRuntimeMaterial, ApiOperationDto, BranchDto, Manifest, ProjectId, PublishRequest, ReleaseDto, RuntimeRevisionRef, ServiceId, SlotDto, TaskId, UserId } from '@crewstation/contracts';

/** api-catalog L3 的公开操作查询，由平台装配。 */
export interface ApiInvocationCatalog {
  listOperations(actor: Actor, serviceId: ServiceId): Promise<ApiOperationDto[]>;
}

export interface ProjectAuthorizer {
  authorize(actor: Actor, projectId: ProjectId, action: 'view' | 'develop' | 'publish' | 'force-release-session'): Promise<unknown>;
  ownerOf(projectId: ProjectId): Promise<UserId | undefined>;
}

export interface ServiceResolver {
  resolveServiceOfProject(projectId: ProjectId): Promise<{ serviceId: ServiceId; slug: string; name: string } | undefined>;
}

/** 由 scm 模块提供。 */
export interface SourceControl {
  listBranches(serviceId: ServiceId, compare: { previewSha?: string; prodSha?: string }): Promise<BranchDto[]>;
  /** 供容器内 git push 使用的短期凭据，已拼进 URL；只在命令执行时传入容器，不落库。 */
  pushUrl(serviceId: ServiceId): Promise<{ url: string; expiresAt: string }>;
  readFile(serviceId: ServiceId, ref: string, path: string): Promise<string | undefined>;
}

/**
 * 由 project 模块提供（RFC-001）：算力档位名 → 具体驱动与模型。
 * 解析发生在平台侧，容器拿到的是已经定好的具体值。
 */
export interface ResolvedCompute {
  name: string;
  driver: AgentDriver;
  model: string;
  taskProfile?: string;
  /** RFC-004：受理时固定的运行环境版本；未绑定即部署配置模式。解析本身在托管配置未就绪时抛 precondition。 */
  runtime?: RuntimeRevisionRef;
}

export interface ComputeCatalog {
  resolve(name: string): Promise<ResolvedCompute | undefined>;
  /** 固定版本的启动材料（含解密凭据）：只在下发命令时取，不落库、不进日志、不进事件。 */
  runtimeMaterial(ref: RuntimeRevisionRef): Promise<AgentRuntimeMaterial>;
  /** 只用于报错时列出可选项。 */
  list(): Promise<Array<{ name: string }>>;
}

/** 由 release 模块提供。 */
export interface Releases {
  publish(actor: Actor, serviceId: ServiceId, input: PublishRequest): Promise<ReleaseDto>;
  getSlots(actor: Actor, serviceId: ServiceId): Promise<SlotDto[]>;
}

export interface ManifestParser {
  parse(text: string): Manifest;
}

/**
 * 由 identity 模块提供：注入 Agent 的远程 MCP 连接凭据（Design §5.9 会话级短期令牌）。
 * 每次启动 Agent 现签一枚，不续期也不缓存；令牌值只从这里流向 TaskRunner，不落库、不进日志。
 */
export interface McpCredentials {
  issueDevSessionToken(binding: { taskId: TaskId; projectId: ProjectId; serviceId: ServiceId; userId: UserId }): Promise<{ token: string; expiresAt: string }>;
}

/** 空闲提醒与强制释放通知；实现接 observability 的告警或工作台通知。 */
export interface Notifier {
  notify(projectId: ProjectId, userIds: UserId[], message: string, context: { taskId: TaskId }): Promise<void>;
}

export interface DevSessionSettings {
  readonly idleMinutes: number;
  readonly userDomain: string;
  /** 注入 Agent 的平台 MCP 连接（能力说明、操作）。 */
  readonly mcp: Array<{ name: string; url: string }>;
  readonly defaultPreviewPort: number;
  /** 起 Agent 时省略 compute 用的默认档位名（RFC-001）。 */
  readonly defaultComputeProfile: string;
}
