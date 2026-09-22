import { UsageError } from '../runtime/cliError';
import type { CommandContext } from '../runtime/commandContext';
import { boolFlag, stringFlag } from '../runtime/commandContext';
import type { InstallConfig } from './installConfig';
import { DEFAULT_NAMESPACE, loadInstallConfig } from './installConfig';
import type { OperatorContext } from './installReport';
import { BUNDLE_ENTRIES, inspectBundle } from './releaseBundle';
import type { ReleaseBundle } from './releaseBundle';

export interface OperatorOptions {
  /** install／upgrade 没有 install.yaml 就无从谈起；status／verify 可以退到默认值。 */
  readonly requireConfig: boolean;
  readonly requireBundle: boolean;
}

export function operatorContext(ctx: CommandContext, options: OperatorOptions): OperatorContext {
  return {
    config: configOf(ctx, options.requireConfig),
    bundle: bundleOf(ctx, options.requireBundle),
    cluster: ctx.cluster(),
    files: ctx.files,
    client: ctx.settings.token === undefined ? undefined : () => ctx.client(),
    dryRun: boolFlag(ctx, 'dry-run'),
  };
}

function configOf(ctx: CommandContext, required: boolean): InstallConfig {
  const path = stringFlag(ctx, 'config');
  if (path !== undefined) return loadInstallConfig(ctx.files, path);
  if (required) throw new UsageError('缺少 --config <install.yaml>', '  Design §11.3 给了完整示例');
  return defaultInstallConfig(ctx.settings.apiUrl);
}

function bundleOf(ctx: CommandContext, required: boolean): ReleaseBundle {
  const path = stringFlag(ctx, 'bundle');
  if (path !== undefined) return inspectBundle(ctx.files, path);
  if (required) throw new UsageError('缺少 --bundle <crewstation-release>', '  指向解开后的发行包目录（Design §11.2）');
  return emptyBundle();
}

/** status／verify 不看 install.yaml 时的兜底：命名空间用默认值，控制台主机从 API 地址推。 */
export function defaultInstallConfig(apiUrl: string): InstallConfig {
  const host = hostOf(apiUrl);
  return {
    profile: 'kind-dev',
    namespace: DEFAULT_NAMESPACE,
    controlPlaneReplicas: 1,
    consoleHost: host,
    appsDomain: host.replace(/^console\./, ''),
    previewDomain: host.replace(/^console\./, ''),
    serviceDomain: 'svc.cs.internal',
    sourceIpPreserved: false,
    sourceControlBaseUrl: '',
    sourceControlGroupId: '',
    protectedTagPattern: 'v*',
    gitlabEventProducer: false,
    referenceApiProxy: false,
    defaultConcurrentTasksPerWorker: 3,
    raw: {},
  };
}

function hostOf(apiUrl: string): string {
  try {
    return new URL(apiUrl).host;
  } catch {
    return apiUrl;
  }
}

function emptyBundle(): ReleaseBundle {
  return {
    root: '（未提供）',
    version: undefined,
    images: [],
    entries: BUNDLE_ENTRIES.map((entry) => ({ path: entry.path, purpose: entry.purpose, present: false })),
    missing: BUNDLE_ENTRIES.map((entry) => entry.path),
  };
}
