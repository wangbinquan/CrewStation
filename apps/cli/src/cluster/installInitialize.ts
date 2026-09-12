import type { ApiClient, CreateProjectInput } from '@crewstation/api-client';
import { isApiClientError } from '@crewstation/api-client';
import { EgressFqdnPatternSchema } from '@crewstation/contracts';
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
    return [line('初始化', 'pending-config', '没有平台令牌，无法写套餐、白名单与接入容器项目；先用 --token 或 CS_TOKEN 提供管理员令牌')];
  }
  const api = client();
  return [
    ...(await seedCatalog(ctx, api)),
    await seedEgress(ctx, api),
    await seedIntegrationProjects(ctx, api),
    line('最小样例模板', 'not-implemented', '模板由 cs-controller 建项目时从发行包取；平台 API 没有注册模板的路由'),
    line('源码托管连接、上游连接与开放策略', 'not-implemented', '这三项的管理端路由尚未在 cs-api 落地（Plan M4）'),
    line('管理员', 'pending-config', '管理员标记按用户 ID 设置（PUT /v1/users/:id/admin），需要对方先登录过一次'),
  ];
}

/**
 * 套餐、任务容器规格与算力档位（RFC-001）都来自发行包 profiles/。
 * 算力档位单独报一行：它缺了会让「开发会话起 Agent」整条路径不可用，而套餐缺了只是建项目时要指定别的，
 * 两者的严重性不同，混在一行里管理员看不出该先补哪个。
 */
async function seedCatalog(ctx: OperatorContext, api: ApiClient): Promise<readonly CheckLine[]> {
  const profiles = readBundleProfiles(ctx.files, ctx.bundle.root);
  const suffix = profiles.notes.length > 0 ? `（${profiles.notes.join('；')}）` : '';
  return [await seedPlans(api, profiles, suffix), await seedComputeProfiles(api, profiles, suffix)];
}

async function seedPlans(api: ApiClient, profiles: BundleProfiles, suffix: string): Promise<CheckLine> {
  const label = '服务套餐与任务容器规格';
  if (profiles.servicePlans.length === 0 && profiles.taskProfiles.length === 0) {
    return line(label, 'pending-config', profiles.notes.join('；') || '发行包 profiles/ 没有可用套餐');
  }
  const results = [
    ...(await Promise.all(profiles.servicePlans.map(async (plan) => [`服务套餐 ${plan.name}`, await attempt(() => api.catalog.upsertServicePlan(plan))] as const))),
    ...(await Promise.all(profiles.taskProfiles.map(async (item) => [`任务规格 ${item.name}`, await attempt(() => api.catalog.upsertTaskProfile(item))] as const))),
  ];
  const failures = results.filter(([, result]) => result.kind === 'failed').map(([name, result]) => `${name}：${result.kind === 'failed' ? result.problem : ''}`);
  if (failures.length > 0) return line(label, 'failed', failures.join('；'));
  return line(label, 'ok', `写入 ${results.length} 条${suffix}`);
}

async function seedComputeProfiles(api: ApiClient, profiles: BundleProfiles, suffix: string): Promise<CheckLine> {
  const label = '算力档位';
  if (profiles.computeProfiles.length === 0) {
    return line(label, 'pending-config', `发行包没有 profiles/compute-profiles.yaml；在平台管理里补一档之前，开发会话与业务子任务都起不了 Agent${suffix}`);
  }
  const results = await Promise.all(profiles.computeProfiles.map(async (item) => [item.name, await attempt(() => api.catalog.upsertComputeProfile(item))] as const));
  const failures = results.filter(([, result]) => result.kind === 'failed').map(([name, result]) => `${name}：${result.kind === 'failed' ? result.problem : ''}`);
  if (failures.length > 0) return line(label, 'failed', failures.join('；'));
  return line(label, 'ok', `写入 ${results.map(([name]) => name).join('、')}${suffix}`);
}

/** 全局出站白名单：install.yaml 的示例含 `<model-endpoints>` 这类占位符，按契约的 FQDN 规则筛掉并点名。 */
async function seedEgress(ctx: OperatorContext, api: ApiClient): Promise<CheckLine> {
  const label = '全局出站白名单';
  const wanted = ctx.config.egressAllowlist;
  if (wanted.length === 0) return line(label, 'pending-config', 'egress.allowlist 为空');
  const valid = wanted.filter((fqdn) => EgressFqdnPatternSchema.safeParse(fqdn).success);
  const invalid = wanted.filter((fqdn) => !EgressFqdnPatternSchema.safeParse(fqdn).success);
  const existing = await attemptValue(() => api.egress.listEntries());
  if (typeof existing === 'string') return line(label, 'failed', existing);
  const present = new Set(existing.items.map((entry) => entry.fqdn));
  const todo = valid.filter((fqdn) => !present.has(fqdn));
  const results = await Promise.all(todo.map(async (fqdn) => [fqdn, await attempt(() => api.egress.addEntry({ fqdn, scope: 'global', note: '安装器写入' }))] as const));
  const failures = results.filter(([, result]) => result.kind === 'failed').map(([fqdn, result]) => `${fqdn}：${result.kind === 'failed' ? result.problem : ''}`);
  const skipped = invalid.length === 0 ? '' : `；占位符未写入：${invalid.join('、')}`;
  if (failures.length > 0) return line(label, 'failed', failures.join('；') + skipped);
  return line(label, invalid.length > 0 ? 'limited' : 'ok', `新增 ${todo.length} 条，已存在 ${valid.length - todo.length} 条${skipped}`);
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
    wanted.push({ slug: 'gitlab-event-producer', name: '内置 GitLab 事件生产者', kind: 'EventProducer', template: 'gitlab-event-producer' });
  }
  if (ctx.config.referenceApiProxy) {
    wanted.push({ slug: 'reference-api-proxy', name: '参考 API 代理', kind: 'APIProxy', template: 'reference-api-proxy' });
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
