import type { ApiClient, FetchLike } from '@crewstation/api-client';
import type { ClusterAccess } from '../cluster/clusterAccess';
import type { Emitter } from '../output/emit';
import type { CommandIo } from '../output/emit';
import { UsageError } from './cliError';
import type { CliSettings, FlagValues } from './settings';

/** 文件系统的最小面：发行包与配置文件都只需要这三件事，测试给个内存实现即可。 */
export interface FileAccess {
  readText(path: string): string | undefined;
  exists(path: string): boolean;
  listDir(path: string): readonly string[];
}

/** 每个命令拿到的全部依赖；命令自身不碰 process、不碰 fs、不碰真实网络。 */
export interface CommandContext {
  readonly io: CommandIo;
  readonly emit: Emitter;
  /** 命令名之后的位置参数。 */
  readonly args: readonly string[];
  readonly flags: FlagValues;
  readonly json: boolean;
  readonly settings: CliSettings;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly files: FileAccess;
  readonly fetch: FetchLike;
  /** 惰性：只有真要调平台时才要求令牌。 */
  client(): ApiClient;
  /** 惰性：只有运维命令才要求 kubectl。 */
  cluster(): ClusterAccess;
}

export function stringFlag(ctx: CommandContext, name: string): string | undefined {
  const value = ctx.flags[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function requiredStringFlag(ctx: CommandContext, name: string): string {
  const value = stringFlag(ctx, name);
  if (value === undefined) throw new UsageError(`缺少必需的 --${name}`);
  return value;
}

export function boolFlag(ctx: CommandContext, name: string): boolean {
  return ctx.flags[name] === true;
}

export function requiredArg(ctx: CommandContext, index: number, name: string): string {
  const value = ctx.args[index];
  if (value === undefined || value.length === 0) throw new UsageError(`缺少位置参数 <${name}>`);
  return value;
}

/** 枚举型标志：取值不在集合里就是用法错误，把合法取值一并告诉使用者。 */
export function enumFlag<T extends string>(ctx: CommandContext, name: string, allowed: readonly T[], fallback?: T): T {
  const value = stringFlag(ctx, name);
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    throw new UsageError(`缺少必需的 --${name}`, `  可选值：${allowed.join('、')}`);
  }
  const hit = allowed.find((item) => item === value);
  if (hit === undefined) throw new UsageError(`--${name} 的取值 ${value} 不合法`, `  可选值：${allowed.join('、')}`);
  return hit;
}
