import type { ApiClient, FetchLike } from '@crewstation/api-client';
import type { ClusterAccess } from '../cluster/clusterAccess';
import { createKubectlAccess } from '../cluster/kubectlAccess';
import type { CommandIo } from '../output/emit';
import { createEmitter } from '../output/emit';
import { colourEnabled, createStylist } from '../output/stylize';
import type { ExitCode } from './cliError';
import { errorLines, EXIT, exitCodeFor } from './cliError';
import type { CommandContext, FileAccess } from './commandContext';
import { configFilePath, parseConfigFile } from './configFile';
import { commandHelp, rootHelp } from './help';
import type { ParseResult } from './parseArgv';
import { parseArgv } from './parseArgv';
import { createPlatformClient } from './platformAccess';
import type { CliSettings, FlagValues } from './settings';
import { resolveSettings } from './settings';

/** 进程边界上的一切都在这里注入，命令自身零副作用，测试因此不需要网络、集群或真实文件。 */
export interface CliDeps {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly io: CommandIo;
  readonly isTty: boolean;
  readonly homeDir: string;
  readonly files: FileAccess;
  readonly fetch: FetchLike;
  /** 缺省是外挂 kubectl；测试注入假集群。 */
  readonly cluster?: (settings: CliSettings) => ClusterAccess;
}

export async function runCli(deps: CliDeps): Promise<ExitCode> {
  const style = createStylist(colourEnabled({ isTty: deps.isTty, noColorFlag: deps.argv.includes('--no-color'), env: deps.env }));
  try {
    const parsed = parseArgv(deps.argv);
    if (parsed.kind === 'help') {
      for (const line of parsed.command === undefined ? rootHelp(deps.homeDir) : commandHelp(parsed.command, deps.homeDir)) deps.io.out(line);
      return EXIT.ok;
    }
    await parsed.command.run(buildContext(parsed, deps, style));
    return EXIT.ok;
  } catch (error) {
    const lines = errorLines(error);
    const [first, ...rest] = lines;
    if (first !== undefined) deps.io.err(style('red', first));
    for (const line of rest) deps.io.err(line);
    return exitCodeFor(error);
  }
}

function buildContext(parsed: Extract<ParseResult, { kind: 'command' }>, deps: CliDeps, style: ReturnType<typeof createStylist>): CommandContext {
  const settings = buildSettings(parsed.flags, deps);
  let client: ApiClient | undefined;
  let cluster: ClusterAccess | undefined;
  return {
    io: deps.io,
    emit: createEmitter(deps.io, style),
    args: parsed.args,
    flags: parsed.flags,
    json: parsed.flags.json === true,
    settings,
    env: deps.env,
    files: deps.files,
    fetch: deps.fetch,
    client: () => (client ??= createPlatformClient(settings, deps.fetch)),
    cluster: () => (cluster ??= (deps.cluster ?? defaultCluster)(settings)),
  };
}

function defaultCluster(settings: CliSettings): ClusterAccess {
  return createKubectlAccess({ context: settings.kubeContext });
}

/** 配置文件读不到不是错误（多数人只用环境变量）；读到但坏了才报错。 */
function buildSettings(flags: FlagValues, deps: CliDeps): CliSettings {
  const flag = flags['cli-config'];
  const path = configFilePath({ flag: typeof flag === 'string' ? flag : undefined, env: deps.env, homeDir: deps.homeDir });
  const text = deps.files.readText(path);
  return resolveSettings({
    flags,
    env: deps.env,
    file: text === undefined ? {} : parseConfigFile(text, path),
    configFilePath: path,
    configFileFound: text !== undefined,
  });
}
