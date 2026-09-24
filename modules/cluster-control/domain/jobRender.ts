/**
 * 构建、迁移 Job 记录（RFC-025 T8）里调和器建出 Job 要用的期望，release 写、不含凭据：镜像、命令、明文环境（仓库地址、标签、镜像名）、资源、
 * 截止时间与结束后的保留时间，这一次的凭据 Secret 名（构建的 Git 令牌、迁移的生产配置与数据连接串，建的时候向 release 要）。
 * Job 与 Secret 的名字取自期望里的子对象。记录是数据：字段不全或类型不对就不渲染，不猜。
 */
export interface JobRender {
  readonly namespace: string;
  readonly name: string;
  readonly secret: string;
  readonly releaseId: string;
  readonly purpose: 'build' | 'migration';
  readonly image: string;
  readonly command: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly resources: { readonly cpu: string; readonly memory: string };
  readonly activeDeadlineSeconds: number;
  readonly ttlSecondsAfterFinished: number;
}

type Fields = Readonly<Record<string, unknown>>;
type Spec = { readonly children: readonly { readonly kind: string; readonly namespace?: string; readonly name: string }[]; readonly [field: string]: unknown };
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;
const strings = (value: unknown): value is Readonly<Record<string, string>> => isFields(value) && Object.values(value).every((entry) => typeof entry === 'string');

/** 构建、迁移 Job 记录的渲染输入；没有（旧形状：release 自己建）或字段不全都返回 undefined。 */
export function jobRenderOf(spec: Spec): JobRender | undefined {
  const job = spec['job'];
  if (!isFields(job) || !text(job['releaseId']) || !text(job['image']) || !text(job['envSecret']) || (job['purpose'] !== 'build' && job['purpose'] !== 'migration')) return undefined;
  const command = job['command'], resources = job['resources'];
  if (!Array.isArray(command) || !command.length || !command.every(text) || !strings(job['env']) || !isFields(resources) || !text(resources['cpu']) || !text(resources['memory'])) return undefined;
  if (!positive(job['activeDeadlineSeconds']) || !positive(job['ttlSecondsAfterFinished'])) return undefined;
  const jobs = spec.children.filter((child) => child.kind === 'Job'), secrets = spec.children.filter((child) => child.kind === 'Secret');
  if (jobs.length !== 1 || secrets.length !== 1 || !jobs[0]!.namespace || secrets[0]!.namespace !== jobs[0]!.namespace || secrets[0]!.name !== job['envSecret']) return undefined;
  return {
    namespace: jobs[0]!.namespace, name: jobs[0]!.name, secret: secrets[0]!.name, releaseId: job['releaseId'], purpose: job['purpose'], image: job['image'], command: [...command] as string[],
    env: { ...job['env'] }, resources: { cpu: resources['cpu'], memory: resources['memory'] }, activeDeadlineSeconds: job['activeDeadlineSeconds'], ttlSecondsAfterFinished: job['ttlSecondsAfterFinished'],
  };
}
