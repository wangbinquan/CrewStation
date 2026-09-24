import type { Release } from './release';

export type JobPurpose = 'build' | 'migration';

/** 构建、迁移 Job 的名字（与 release 自己建时相同）：RFC-013 之前的发布沿用旧 ID 的后 12 位，之后的用去掉连字符的发布 ID。 */
export function releaseJobName(release: Pick<Release, 'id' | 'legacyResourceId'>, purpose: JobPurpose): string {
  const suffix = release.legacyResourceId ? release.legacyResourceId.slice(-12) : release.id.replaceAll('-', '');
  return `${purpose === 'build' ? 'build' : 'migrate'}-${suffix}`;
}

/**
 * 构建 Job 的脚本：克隆标签处的仓库，用 buildctl 向 buildkitd 提交 Dockerfile 构建并推送到平台注册表。令牌只在环境变量 GIT_TOKEN 里；
 * 刚签发的 GitLab 项目访问令牌偶尔还没在 Git HTTP 认证路径上生效，克隆会以 401 失败，退避重试三次。
 */
export function buildScript(buildkitAddress: string): string {
  return [
    'set -eu',
    'AUTH_URL=$(echo "$REPO_URL" | sed "s#://#://oauth2:${GIT_TOKEN}@#")',
    'for attempt in 1 2 3; do',
    '  if git clone --quiet --depth 1 --branch "$REF" "$AUTH_URL" /work; then break; fi',
    '  if [ "$attempt" = 3 ]; then echo "clone failed after 3 attempts" >&2; exit 1; fi',
    '  sleep $((attempt * 5))',
    'done',
    'cd /work',
    `buildctl --addr "${buildkitAddress}" build --frontend dockerfile.v0 --local context=. --local dockerfile=. --output type=image,name="$IMAGE",push=true,registry.insecure=true`,
  ].join('\n');
}

/**
 * 资源中心建的构建、迁移 Job（RFC-025 T8）的期望：release 写、不含凭据——构建的 Git 令牌、迁移的生产配置与数据连接串只在这一次的
 * 凭据 Secret（`<Job 名>-env`）里，建的时候向 release 要。env 是不含凭据的明文变量（构建的仓库地址、标签、镜像名）。
 */
export interface JobRender {
  readonly releaseId: string;
  readonly purpose: JobPurpose;
  readonly image: string;
  readonly command: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly resources: { readonly cpu: string; readonly memory: string };
  readonly activeDeadlineSeconds: number;
  readonly ttlSecondsAfterFinished: number;
  readonly envSecret: string;
}

/** 构建 Pod 只做 git clone 与 buildctl 客户端（镜像在 buildkitd 里构建）：按客户端的负载请求，忙碌节点上才排得进去（2026-09-18 本机实测）。 */
export const BUILD_RESOURCES = { cpu: '250m', memory: '512Mi' } as const;
export const MIGRATION_RESOURCES = { cpu: '500m', memory: '512Mi' } as const;
/** Job 结束一小时后由 Kubernetes 删掉（结果留在台账里）。 */
export const JOB_TTL_SECONDS = 3600;

/** 台账的 Job 记录里判结果用得到的部分。 */
export interface ObservedJobRecord {
  readonly conditions: readonly { readonly type: string; readonly status: string; readonly reason?: string; readonly message?: string }[];
}

export type JobOutcome = { readonly state: 'running' } | { readonly state: 'succeeded' } | { readonly state: 'failed'; readonly message: string };

/**
 * 资源中心建的 Job（T8）的结果，替代直接读 Job：资源中心记下的 Finished 是成功或失败；没建成（Created 为假）是失败——Job 记录每次发布一条，
 * 没有上一次留下的条件；其余（还没建、在跑、记录还没跟上）都是还在跑，由流水线的时限兜底。
 */
export function jobOutcomeOf(record: ObservedJobRecord | undefined): JobOutcome {
  const condition = (type: string) => record?.conditions.find((entry) => entry.type === type);
  const finished = condition('Finished'), created = condition('Created');
  if (finished?.status === 'true') return finished.reason === 'failed' ? { state: 'failed', message: finished.message ?? 'Job 失败' } : { state: 'succeeded' };
  if (created?.status === 'false') return { state: 'failed', message: created.message ?? 'Job 没有建成' };
  return { state: 'running' };
}
