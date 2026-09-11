import { CliFailure } from './cliError';

/** 用户配置文件里承认的键；多余的键忽略，便于以后加字段而不报错。 */
export interface ConfigFileValues {
  readonly apiUrl?: string;
  readonly token?: string;
  readonly kubeContext?: string;
}

export const CONFIG_FILE_NAME = 'config.json';
export const CONFIG_DIR_NAME = 'crewstation';

export interface ConfigPathInput {
  /** --cli-config 的取值。 */
  readonly flag: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDir: string;
}

/** 路径本身的解析顺序与取值一致：标志 → 环境变量 → XDG → 家目录。 */
export function configFilePath(input: ConfigPathInput): string {
  if (input.flag !== undefined && input.flag.length > 0) return input.flag;
  const fromEnv = input.env.CS_CLI_CONFIG;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  const xdg = input.env.XDG_CONFIG_HOME;
  const base = typeof xdg === 'string' && xdg.length > 0 ? xdg : `${input.homeDir}/.config`;
  return `${base}/${CONFIG_DIR_NAME}/${CONFIG_FILE_NAME}`;
}

/**
 * 解析配置文件。出错时只报路径与问题，绝不把文件内容写进消息或日志：
 * 里面有令牌，泄进终端记录或 CI 日志就等于泄密。
 */
export function parseConfigFile(text: string, path: string): ConfigFileValues {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new CliFailure(`配置文件不是合法 JSON：${path}`, ['  修好它，或用 --cli-config 指向别的文件']);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CliFailure(`配置文件顶层必须是对象：${path}`, ['  形如 {"apiUrl": "http://console.cs.localhost", "token": "…"}']);
  }
  const record = parsed as Record<string, unknown>;
  return {
    ...stringField(record, 'apiUrl'),
    ...stringField(record, 'token'),
    ...stringField(record, 'kubeContext'),
  };
}

function stringField(record: Record<string, unknown>, key: keyof ConfigFileValues): ConfigFileValues {
  const value = record[key];
  return typeof value === 'string' ? { [key]: value } : {};
}
