import type { Actor, BranchDto, Manifest, ProjectId, PublishRequest, ReleaseDto, ServiceId, SlotDto, TaskId, UserId } from '@crewstation/contracts';

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
}
