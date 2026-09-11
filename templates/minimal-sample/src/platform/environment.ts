/**
 * 业务容器内可读的环境变量名。字面值镜像平台约定表 packages/contracts/convention.ts 的 PLATFORM_ENV：
 * 模板是独立项目，不 import 任何工作区包，因此在此抄录一份。值由平台在部署与开发会话启动时注入。
 */
export const PLATFORM_ENV = {
  project: 'CS_PROJECT',
  service: 'CS_SERVICE',
  /** preview｜prod：同一个生产服务的两个蓝绿槽。 */
  slot: 'CS_SLOT',
  /** production｜development：两个槽都是 production，开发会话是 development。 */
  environment: 'CS_ENVIRONMENT',
  /** 平台 API 的服务域地址；以本服务身份调用，不带任何凭据。 */
  platformApiUrl: 'CS_PLATFORM_API_URL',
  port: 'PORT',
} as const;

/** crewstation.yaml `spec.env` 声明的配置项；平台按当前取值组注入为同名环境变量。 */
export const CONFIG_ENV = {
  greeting: 'GREETING',
} as const;

export const DEFAULT_PORT = 3000;

export interface DeploymentInfo {
  project: string | null;
  service: string | null;
  slot: string | null;
  environment: string | null;
  /** 已去掉末尾斜杠；为 null 表示未注入，此时 Agent 对话不可用。 */
  platformApiUrl: string | null;
  greeting: string | null;
  port: number;
}

export function readDeploymentInfo(env: Record<string, string | undefined>): DeploymentInfo {
  const port = Number(env[PLATFORM_ENV.port]);
  return {
    project: optional(env[PLATFORM_ENV.project]),
    service: optional(env[PLATFORM_ENV.service]),
    slot: optional(env[PLATFORM_ENV.slot]),
    environment: optional(env[PLATFORM_ENV.environment]),
    platformApiUrl: optional(env[PLATFORM_ENV.platformApiUrl])?.replace(/\/+$/, '') ?? null,
    greeting: optional(env[CONFIG_ENV.greeting]),
    port: Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT,
  };
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
