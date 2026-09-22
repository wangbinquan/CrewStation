import { CliFailure } from '../runtime/cliError';
import type { FileAccess } from '../runtime/commandContext';

/** Design §11.3 的 install.yaml；这里只收录安装器真正会用到的字段，其余原样留在 raw 里。 */
export interface InstallConfig {
  readonly profile: 'production' | 'kind-dev';
  readonly namespace: string;
  readonly controlPlaneReplicas: number;
  readonly consoleHost: string;
  readonly appsDomain: string;
  readonly previewDomain: string;
  readonly serviceDomain: string;
  readonly sourceIpPreserved: boolean;
  readonly sourceControlBaseUrl: string;
  readonly sourceControlGroupId: string;
  readonly protectedTagPattern: string;
  readonly gitlabEventProducer: boolean;
  readonly referenceApiProxy: boolean;
  readonly defaultConcurrentTasksPerWorker: number;
  readonly raw: Readonly<Record<string, unknown>>;
}

const PROFILES = ['production', 'kind-dev'] as const;

/** 没写 namespace 时的落点；与 deploy/ 里本机 kind 集群用的命名空间一致。 */
export const DEFAULT_NAMESPACE = 'crewstation-system';

export function loadInstallConfig(files: FileAccess, path: string): InstallConfig {
  const text = files.readText(path);
  if (text === undefined) throw new CliFailure(`读不到安装配置：${path}`, ['  用 --config 指向 install.yaml（Design §11.3 给了完整示例）']);
  return parseInstallConfig(text, path);
}

/** 一次收齐所有问题再报错：装集群的人不该被“修一条、再跑一次”折腾七轮。 */
export function parseInstallConfig(text: string, path: string): InstallConfig {
  const root = asRecord(Bun.YAML.parse(text));
  if (root === undefined) throw new CliFailure(`安装配置的顶层必须是映射：${path}`);
  const problems: string[] = [];
  const network = asRecord(root.network) ?? {};
  const scm = asRecord(root.sourceControl) ?? {};
  const integrations = asRecord(root.integrations) ?? {};
  // RFC-018 下线出站白名单后不再读 `egress` 段；旧配置文件里留着它不报错，也不出预检行。
  const config: InstallConfig = {
    profile: enumField(root.profile, PROFILES, 'profile', problems),
    namespace: stringField(root.namespace, 'namespace', problems, DEFAULT_NAMESPACE),
    controlPlaneReplicas: intField(asRecord(root.controlPlane)?.replicas, 'controlPlane.replicas', problems, 1),
    consoleHost: stringField(network.consoleHost, 'network.consoleHost', problems),
    appsDomain: stringField(network.appsDomain, 'network.appsDomain', problems),
    previewDomain: stringField(network.previewDomain, 'network.previewDomain', problems),
    serviceDomain: stringField(network.serviceDomain, 'network.serviceDomain', problems),
    sourceIpPreserved: network.sourceIpPreserved === true,
    sourceControlBaseUrl: stringField(scm.baseUrl, 'sourceControl.baseUrl', problems),
    sourceControlGroupId: stringField(scm.groupId, 'sourceControl.groupId', problems),
    protectedTagPattern: stringField(scm.protectedTagPattern, 'sourceControl.protectedTagPattern', problems, 'v*'),
    gitlabEventProducer: asRecord(integrations.gitlabEventProducer)?.enabled === true,
    referenceApiProxy: asRecord(integrations.referenceApiProxy)?.enabled === true,
    defaultConcurrentTasksPerWorker: intField(asRecord(root.quotas)?.defaultConcurrentTasksPerWorker, 'quotas.defaultConcurrentTasksPerWorker', problems, 3),
    raw: root,
  };
  if (problems.length > 0) throw new CliFailure(`安装配置有 ${problems.length} 处问题：${path}`, problems.map((item) => '  ' + item));
  return config;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringField(value: unknown, name: string, problems: string[], fallback?: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value === undefined && fallback !== undefined) return fallback;
  problems.push(`${name} 必须是非空字符串`);
  return fallback ?? '';
}

function intField(value: unknown, name: string, problems: string[], fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return value;
  problems.push(`${name} 必须是不小于 1 的整数`);
  return fallback;
}

function enumField<T extends string>(value: unknown, allowed: readonly T[], name: string, problems: string[]): T {
  const hit = allowed.find((item) => item === value);
  if (hit !== undefined) return hit;
  problems.push(`${name} 必须是 ${allowed.join(' 或 ')}`);
  return allowed[0] as T;
}

