import type { ConfigFileValues } from './configFile';

/** 取值来源，只用于 `status` 与 `--help` 里说明“这次用的是哪一层”，永远不带出取值本身。 */
export type SettingSource = 'flag' | 'env' | 'file' | 'default' | 'unset';

export type FlagValues = Readonly<Record<string, string | boolean | undefined>>;

export interface SettingKey {
  readonly name: 'apiUrl' | 'token' | 'kubeContext';
  /** 命令行长标志名（不含 --）。 */
  readonly flag: string;
  readonly env: string;
  /** 配置文件里的键名。 */
  readonly fileKey: keyof ConfigFileValues;
  readonly fallback: string | undefined;
  readonly summary: string;
  /** 机密：不进日志、不进 --json、不进任何人读输出。 */
  readonly secret: boolean;
}

/**
 * 配置解析顺序的唯一真相：命令行标志 → 环境变量 → 用户配置文件 → 内置默认值。
 * `--help` 与 resolveSettings 都读它，说明与实现因此不会漂移。
 */
export const SETTING_KEYS: readonly SettingKey[] = [
  { name: 'apiUrl', flag: 'api', env: 'CS_API_URL', fileKey: 'apiUrl', fallback: 'http://console.cs.localhost', summary: '平台 API 地址（用户域控制台主机）', secret: false },
  { name: 'token', flag: 'token', env: 'CS_TOKEN', fileKey: 'token', fallback: undefined, summary: '平台会话令牌；任何输出都不会回显它', secret: true },
  { name: 'kubeContext', flag: 'kube-context', env: 'CS_KUBE_CONTEXT', fileKey: 'kubeContext', fallback: undefined, summary: 'kubectl 上下文，运维命令用；缺省用 kubectl 当前上下文', secret: false },
];

export interface ResolvedSetting {
  readonly value: string | undefined;
  readonly source: SettingSource;
}

export interface CliSettings {
  readonly apiUrl: string;
  readonly token: string | undefined;
  readonly kubeContext: string | undefined;
  readonly configFilePath: string;
  readonly configFileFound: boolean;
  /** 每个键的来源；取值只在这里以 ResolvedSetting 出现，机密键由调用方自行判断是否展示。 */
  readonly sources: Readonly<Record<SettingKey['name'], SettingSource>>;
}

export interface SettingsInput {
  readonly flags: FlagValues;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly file: ConfigFileValues;
  readonly configFilePath: string;
  readonly configFileFound: boolean;
}

/** 逐键按固定顺序取第一个非空值；空字符串视为未设置，免得 `CS_TOKEN=` 把文件里的值挡掉。 */
export function resolveSetting(key: SettingKey, input: SettingsInput): ResolvedSetting {
  const flag = input.flags[key.flag];
  if (typeof flag === 'string' && flag.length > 0) return { value: flag, source: 'flag' };
  const env = input.env[key.env];
  if (typeof env === 'string' && env.length > 0) return { value: env, source: 'env' };
  const file = input.file[key.fileKey];
  if (typeof file === 'string' && file.length > 0) return { value: file, source: 'file' };
  return key.fallback === undefined ? { value: undefined, source: 'unset' } : { value: key.fallback, source: 'default' };
}

export function resolveSettings(input: SettingsInput): CliSettings {
  const picked = new Map(SETTING_KEYS.map((key) => [key.name, resolveSetting(key, input)] as const));
  const sources = Object.fromEntries([...picked].map(([name, hit]) => [name, hit.source])) as CliSettings['sources'];
  return {
    apiUrl: picked.get('apiUrl')?.value ?? 'http://console.cs.localhost',
    kubeContext: picked.get('kubeContext')?.value,
    token: picked.get('token')?.value,
    configFilePath: input.configFilePath,
    configFileFound: input.configFileFound,
    sources,
  };
}
