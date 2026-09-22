import type { ApiClient, CreateProjectInput } from '@crewstation/api-client';
import { isApiClientError } from '@crewstation/api-client';
import { BUILTIN_RESOURCES } from '@crewstation/contracts';
import type { CheckLine, OperatorContext } from './installReport';
import { checkLine as line } from './installReport';
import type { BundleProfiles } from './releaseBundle';
import { readBundleProfiles } from './releaseBundle';

/** 已存在（409）按幂等成功处理：安装必须可以重跑。 */
type Attempt = { readonly kind: 'created' } | { readonly kind: 'exists' } | { readonly kind: 'failed'; readonly problem: string };

/** Design §11.4 第 5 步“初始化”。能经平台 API 做的这里真做；平台还没有路由的如实报未实现。 */
export async function initializePlatform(ctx: OperatorContext): Promise<readonly CheckLine[]> {
  const client = ctx.client;
  if (ctx.dryRun) return [line('初始化', 'skipped', '--dry-run 只出计划，不写平台目录')];
  if (client === undefined) {
    return [line('初始化', 'pending-config', '没有平台令牌，无法写套餐与接入容器项目；先用 --token 或 CS_TOKEN 提供管理员令牌')];
  }
  const api = client();
  return [
    ...(await seedCatalog(ctx, api)),
    await seedIntegrationProjects(ctx, api),
    line('最小样例模板', 'not-implemented', '模板由 cs-controller 建项目时从发行包取；平台 API 没有注册模板的路由'),
    line('源码托管连接、上游连接与开放策略', 'not-implemented', '这三项的管理端路由尚未在 cs-api 落地（Plan M4）'),
    line('管理员', 'pending-config', '管理员标记按用户 ID 设置（PUT /v1/users/:id/admin），需要对方先登录过一次'),
  ];
}

/**
 * 套餐与任务容器规格来自发行包 profiles/。算力档位不预置（RFC-006）：档位要指定管理员构建的镜像与二进制并真实测试通过才可选，
 * 安装器给不出这些，只单独报一行待配置——它缺了会让「起 Agent」整条路径不可用，严重性与套餐不同。
 */
async function seedCatalog(ctx: OperatorContext, api: ApiClient): Promise<readonly CheckLine[]> {
  const profiles = readBundleProfiles(ctx.files, ctx.bundle.root);
  const suffix = profiles.notes.length > 0 ? `（${profiles.notes.join('；')}）` : '';
  return [await seedPlans(api, profiles, suffix), line('算力档位', 'pending-config', '安装不预置算力档位：请管理员在平台管理里创建档位、测试通过并设为默认，之后开发会话与业务子任务才能起 Agent')];
}

async function seedPlans(api: ApiClient, profiles: BundleProfiles, suffix: string): Promise<CheckLine> {
  const label = '服务套餐与任务容器规格';
  if (profiles.servicePlans.length === 0 && profiles.taskProfiles.length === 0) {
    return line(label, 'pending-config', profiles.notes.join('；') || '发行包 profiles/ 没有可用套餐');
  }
  const results = [
    ...(await Promise.all(profiles.servicePlans.map(async (plan) => [`服务套餐 ${plan.name}`, await attempt(() => api.catalog.createServicePlan(plan))] as const))),
    ...(await Promise.all(profiles.taskProfiles.map(async (item) => [`任务规格 ${item.name}`, await attempt(() => api.catalog.createTaskProfile(item))] as const))),
  ];
  const failures = results.filter(([, result]) => result.kind === 'failed').map(([name, result]) => `${name}：${result.kind === 'failed' ? result.problem : ''}`);
  if (failures.length > 0) return line(label, 'failed', failures.join('；'));
  return line(label, 'ok', `写入 ${results.length} 条${suffix}`);
}

/** 内置 GitLab EventProducer 与参考 APIProxy 的平台项目：这里只建项目，首个标签仍走平台发布流程。 */
async function seedIntegrationProjects(ctx: OperatorContext, api: ApiClient): Promise<CheckLine> {
  const label = '接入容器平台项目';
  const wanted = integrationProjects(ctx);
  if (wanted.length === 0) return line(label, 'skipped', 'integrations 两项都未启用');
  const me = await attemptValue(() => api.me.get());
  if (typeof me === 'string') return line(label, 'failed', me);
  if (!me.isAdmin) return line(label, 'pending-config', '当前令牌不是管理员；代建项目是管理员动作（Design §7.3）');
  const results = await Promise.all(wanted.map(async (project) => [project.slug, await attempt(() => api.projects.create({ ...project, ownerUserId: me.id }))] as const));
  const notes = results.map(([slug, result]) => `${slug} ${describeAttempt(result)}`);
  const failed = results.some(([, result]) => result.kind === 'failed');
  return line(label, failed ? 'failed' : 'ok', notes.join('；') + '；首个标签的构建与发布仍走平台发布流程');
}

function describeAttempt(result: Attempt): string {
  return result.kind === 'created' ? '已创建' : result.kind === 'exists' ? '已存在' : `失败：${result.problem}`;
}

function integrationProjects(ctx: OperatorContext): readonly Omit<CreateProjectInput, 'ownerUserId'>[] {
  const wanted: Omit<CreateProjectInput, 'ownerUserId'>[] = [];
  if (ctx.config.gitlabEventProducer) {
    wanted.push({ slug: 'gitlab-event-producer', name: '内置 GitLab 事件生产者', kind: 'EventProducer', template: BUILTIN_RESOURCES.eventTemplate });
  }
  if (ctx.config.referenceApiProxy) {
    wanted.push({ slug: 'reference-api-proxy', name: '参考 API 代理', kind: 'APIProxy', template: BUILTIN_RESOURCES.proxyTemplate });
  }
  return wanted;
}

async function attempt(call: () => Promise<unknown>): Promise<Attempt> {
  try {
    await call();
    return { kind: 'created' };
  } catch (error) {
    if (isApiClientError(error) && error.kind === 'conflict') return { kind: 'exists' };
    return { kind: 'failed', problem: isApiClientError(error) ? error.message : String(error) };
  }
}

async function attemptValue<T>(call: () => Promise<T>): Promise<T | string> {
  try {
    return await call();
  } catch (error) {
    return isApiClientError(error) ? error.message : String(error);
  }
}
