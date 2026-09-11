import type { ServicePlanInput, TaskProfileInput } from '@crewstation/api-client';
import { CliFailure } from '../runtime/cliError';
import type { FileAccess } from '../runtime/commandContext';

/** Design §11.2 的发行包目录；安装器逐项检查，缺什么就说缺什么。 */
export const BUNDLE_ENTRIES: readonly { readonly path: string; readonly dir: boolean; readonly purpose: string }[] = [
  { path: 'release.lock.yaml', dir: false, purpose: '版本、镜像摘要、依赖兼容与最低条件' },
  { path: 'charts', dir: true, purpose: '平台与依赖 Charts，含出站代理与日志采集' },
  { path: 'images', dir: true, purpose: '离线镜像或受控导入清单，含任务容器镜像' },
  { path: 'schemas', dir: true, purpose: '安装配置与三种 Manifest 的 Schema' },
  { path: 'templates/minimal-sample', dir: true, purpose: '最小样例模板' },
  { path: 'templates/gitlab-event-producer', dir: true, purpose: '内置 GitLab EventProducer 项目模板' },
  { path: 'templates/reference-api-proxy', dir: true, purpose: '参考 APIProxy 项目模板' },
  { path: 'profiles', dir: true, purpose: '服务套餐、任务容器规格、数据与配额套餐' },
  { path: 'migrations', dir: true, purpose: '平台表结构与资源迁移' },
  { path: 'checks', dir: true, purpose: '预检、安装验收、升级与恢复测试' },
  { path: 'licenses-and-sbom', dir: true, purpose: '许可与 SBOM' },
];

export interface BundleEntryReport {
  readonly path: string;
  readonly present: boolean;
  readonly purpose: string;
}

export interface ReleaseBundle {
  readonly root: string;
  readonly version: string | undefined;
  readonly images: readonly string[];
  readonly entries: readonly BundleEntryReport[];
  readonly missing: readonly string[];
}

export function inspectBundle(files: FileAccess, root: string): ReleaseBundle {
  if (!files.exists(root)) throw new CliFailure(`发行包目录不存在：${root}`, ['  用 --bundle 指向解开后的 crewstation-release 目录']);
  const entries = BUNDLE_ENTRIES.map((entry) => ({ path: entry.path, purpose: entry.purpose, present: files.exists(join(root, entry.path)) }));
  const lock = readLock(files, root);
  return {
    root,
    version: lock.version,
    images: lock.images,
    entries,
    missing: entries.filter((entry) => !entry.present).map((entry) => entry.path),
  };
}

/** 发行包的套餐定义；安装第 5 阶段据此写入平台目录。缺文件不是错误，报告里说明即可。 */
export interface BundleProfiles {
  readonly servicePlans: readonly ServicePlanInput[];
  readonly taskProfiles: readonly TaskProfileInput[];
  readonly notes: readonly string[];
}

export function readBundleProfiles(files: FileAccess, root: string): BundleProfiles {
  const notes: string[] = [];
  const servicePlans = readList<ServicePlanInput>(files, join(root, 'profiles/service-plans.yaml'), notes, isServicePlan);
  const taskProfiles = readList<TaskProfileInput>(files, join(root, 'profiles/task-profiles.yaml'), notes, isTaskProfile);
  return { servicePlans, taskProfiles, notes };
}

function readLock(files: FileAccess, root: string): { version: string | undefined; images: readonly string[] } {
  const text = files.readText(join(root, 'release.lock.yaml'));
  if (text === undefined) return { version: undefined, images: [] };
  const parsed: unknown = Bun.YAML.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { version: undefined, images: [] };
  const record = parsed as Record<string, unknown>;
  const version = typeof record.version === 'string' ? record.version : undefined;
  return { version, images: imageRefs(record.images) };
}

/** images 既允许 `名字: 摘要` 映射，也允许字符串数组；两种写法都归一成 `名字@摘要`。 */
function imageRefs(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value as Record<string, unknown>).map(([name, digest]) => (typeof digest === 'string' ? `${name}@${digest}` : name));
}

function readList<T>(files: FileAccess, path: string, notes: string[], guard: (value: Record<string, unknown>) => boolean): readonly T[] {
  const text = files.readText(path);
  if (text === undefined) {
    notes.push(`发行包缺 ${path}，跳过这一类套餐`);
    return [];
  }
  const parsed: unknown = Bun.YAML.parse(text);
  if (!Array.isArray(parsed)) {
    notes.push(`${path} 的顶层必须是列表，已忽略`);
    return [];
  }
  const valid = parsed.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && guard(item as Record<string, unknown>));
  if (valid.length !== parsed.length) notes.push(`${path} 有 ${parsed.length - valid.length} 条字段不全，已忽略`);
  return valid as readonly T[];
}

function isServicePlan(value: Record<string, unknown>): boolean {
  return typeof value.name === 'string' && typeof value.cpu === 'string' && typeof value.memory === 'string' && typeof value.maxReplicas === 'number';
}

function isTaskProfile(value: Record<string, unknown>): boolean {
  return typeof value.name === 'string' && typeof value.cpu === 'string' && typeof value.memory === 'string' && typeof value.storage === 'string';
}

export function join(root: string, rel: string): string {
  return root.endsWith('/') ? `${root}${rel}` : `${root}/${rel}`;
}
