/**
 * 平台注入的环境变量。字面值镜像平台约定表 packages/contracts/convention.ts 的 PLATFORM_ENV：
 * 接入容器和数字人一样是独立项目，不 import 任何工作区包，因此在此抄录一份。
 */
export const PLATFORM_ENV = {
  project: 'CS_PROJECT',
  service: 'CS_SERVICE',
  /** preview｜prod：同一个生产服务的两个蓝绿槽。 */
  slot: 'CS_SLOT',
  /** production｜development：两个槽都是 production，开发会话是 development。 */
  environment: 'CS_ENVIRONMENT',
  port: 'PORT',
  platformApiUrl: 'CS_PLATFORM_API_URL',
} as const;

/** crewstation.yaml `spec.env` 声明的配置项；平台按当前取值组注入为同名环境变量。 */
export const CONFIG_ENV = {
  /** 上游地址。集群内本机测试 GitLab 走 host.docker.internal（deploy/k8s/platform/10-config.yaml 的 CS_GITLAB_URL 同此）。 */
  upstreamBaseUrl: 'GITLAB_BASE_URL',
  /** 密钥：上游访问令牌，由项目负责人在工作台维护；Manifest 不给默认值，代码里也不存任何长期凭据。 */
  upstreamToken: 'GITLAB_TOKEN',
} as const;

export const DEFAULT_PORT = 3000;

export interface DeploymentInfo {
  project: string | null;
  service: string | null;
  slot: string | null;
  environment: string | null;
  /** 已去掉末尾斜杠；为 null 表示未注入上游地址，此时一律 503。 */
  upstreamBaseUrl: string | null;
  /** 未配置令牌时为 null：仍然转发，由上游按匿名身份决定给什么——代理不代替上游做判断。 */
  upstreamToken: string | null;
  port: number;
  platformApiUrl: string | null;
}

export function readDeploymentInfo(env: Record<string, string | undefined>): DeploymentInfo {
  const port = Number(env[PLATFORM_ENV.port]);
  return {
    project: optional(env[PLATFORM_ENV.project]),
    service: optional(env[PLATFORM_ENV.service]),
    slot: optional(env[PLATFORM_ENV.slot]),
    environment: optional(env[PLATFORM_ENV.environment]),
    upstreamBaseUrl: optional(env[CONFIG_ENV.upstreamBaseUrl])?.replace(/\/+$/, '') ?? null,
    upstreamToken: optional(env[CONFIG_ENV.upstreamToken]),
    port: Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT,
    platformApiUrl: optional(env[PLATFORM_ENV.platformApiUrl]),
  };
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
