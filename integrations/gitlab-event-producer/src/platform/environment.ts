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
  /** 服务域后缀，例如 `svc.cs.internal`；cs-events 的地址由它推导。 */
  serviceDomain: 'CS_SERVICE_DOMAIN',
  port: 'PORT',
} as const;

/** crewstation.yaml `spec.env` 声明的配置项；平台按当前取值组注入为同名环境变量。 */
export const CONFIG_ENV = {
  /** 密钥：GitLab webhook 上配置的 Secret token，由项目负责人在工作台维护，Manifest 不给默认值。 */
  webhookSecretToken: 'GITLAB_WEBHOOK_SECRET_TOKEN',
} as const;

/**
 * 仅本机开发用的覆盖项：**不**在 Manifest `spec.env` 里声明，因此平台部署时不会注入它，
 * 生产地址只能由 CS_SERVICE_DOMAIN 推导，避免把某一套环境的域名写死进 Manifest。
 */
export const EVENTS_BASE_URL_OVERRIDE = 'EVENTS_BASE_URL';

/** cs-events 在服务域上的主机名前缀，镜像 packages/contracts/convention.ts 的 PLATFORM_SERVICE_HOSTS.events。 */
export const EVENTS_HOST_PREFIX = 'events';

/** cs-events 受理生产方投递的路径（packages/contracts + modules/events/http/ingressRoutes.ts）。 */
export const PRODUCE_PATH = '/v1/events/produce';

export const DEFAULT_PORT = 3000;

export interface DeploymentInfo {
  project: string | null;
  service: string | null;
  slot: string | null;
  environment: string | null;
  /** 已去掉末尾斜杠；为 null 表示既没有 CS_SERVICE_DOMAIN 也没有本机覆盖，此时不能投递。 */
  eventsBaseUrl: string | null;
  /** 未配置密钥时为 null，webhook 一律拒绝。 */
  webhookSecretToken: string | null;
  port: number;
}

export function readDeploymentInfo(env: Record<string, string | undefined>): DeploymentInfo {
  const port = Number(env[PLATFORM_ENV.port]);
  return {
    project: optional(env[PLATFORM_ENV.project]),
    service: optional(env[PLATFORM_ENV.service]),
    slot: optional(env[PLATFORM_ENV.slot]),
    environment: optional(env[PLATFORM_ENV.environment]),
    eventsBaseUrl: resolveEventsBaseUrl(env),
    webhookSecretToken: optional(env[CONFIG_ENV.webhookSecretToken]),
    port: Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT,
  };
}

/** 本机覆盖优先，其次按服务域推导 `http://events.<serviceDomain>`；请求不带任何凭据，身份由网关按源 Pod IP 解析。 */
export function resolveEventsBaseUrl(env: Record<string, string | undefined>): string | null {
  const override = optional(env[EVENTS_BASE_URL_OVERRIDE]);
  if (override) return stripTrailingSlash(override);
  const domain = optional(env[PLATFORM_ENV.serviceDomain]);
  return domain ? `http://${EVENTS_HOST_PREFIX}.${stripTrailingSlash(domain)}` : null;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}
