/**
 * RFC-004：启动前 Hook 成功后交给驱动装配的托管运行环境上下文。
 * home 是进程私有的 HOME；configFile 是管理员绑定给 CLI 加载的文件（已由 Hook 写出）。
 * 驱动把它与平台必需项（MCP 身份、轮次观测、受控模型）合成为最终配置，不静默覆盖任何一方。
 */
export interface ManagedRuntimeContext {
  readonly home: string;
  readonly runDir: string;
  readonly configFile?: { readonly kind: 'claude-settings' | 'opencode-config'; readonly path: string };
}

/** 驱动读管理员配置文件失败时的错误码：平台把它归入“最终 CLI 配置校验”阶段。 */
export const CLI_CONFIG_INVALID = 'cli_config_invalid';
