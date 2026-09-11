import type { PublishInput } from '@crewstation/api-client';
import type { ReleaseDto, SlotName, TrafficSwitchRequest } from '@crewstation/contracts';
import { RELEASE_TAG_PATTERN } from '@crewstation/contracts';
import { dash, shortSha, shortTime } from '../output/formatValue';
import { requireServiceId, resolveProject } from '../platform/projectLookup';
import { UsageError } from '../runtime/cliError';
import type { CommandContext } from '../runtime/commandContext';
import { enumFlag, requiredArg, requiredStringFlag, stringFlag } from '../runtime/commandContext';

const BUMPS = ['major', 'minor', 'patch'] as const;
const SLOTS: readonly SlotName[] = ['preview', 'prod'];

/**
 * 发布：与工作台按钮同一条路由（POST /v1/projects/:id/publish）。
 * 平台先查未提交内容，再代推、打标签、构建、迁移，最后部署到待命槽；
 * git push 不是发布，这里也只是触发那条固定发布链。
 */
export async function publish(ctx: CommandContext): Promise<void> {
  const api = ctx.client();
  const project = await resolveProject(api, requiredArg(ctx, 0, 'project'));
  const message = stringFlag(ctx, 'message');
  const input: PublishInput = {
    branch: requiredStringFlag(ctx, 'branch'),
    ...versionOf(ctx),
    ...(message === undefined ? {} : { message }),
  };
  const release = await api.devSession.publish(project.id, input);
  if (ctx.json) return ctx.emit.json(release);
  ctx.emit.success(`已受理发布：${release.tag}（${release.status}）`);
  ctx.emit.fields(releaseFields(release));
  ctx.emit.note('构建与迁移通过后部署到待命槽；随后由项目负责人执行 crewstation traffic switch 切流');
}

/** 版本号要么是完整的 v 大.小.patch，要么是递增级别；两者都不给按 patch 递增。 */
function versionOf(ctx: CommandContext): { version?: string } {
  const raw = stringFlag(ctx, 'version');
  if (raw === undefined) return {};
  if (RELEASE_TAG_PATTERN.test(raw) || BUMPS.some((bump) => bump === raw)) return { version: raw };
  throw new UsageError(`--version 的取值 ${raw} 不合法`, '  用 v1.2.3 这样的完整标签，或 major／minor／patch');
}

export async function listReleases(ctx: CommandContext): Promise<void> {
  const api = ctx.client();
  const project = await resolveProject(api, requiredArg(ctx, 0, 'project'));
  const page = await api.services.listReleases(requireServiceId(project));
  if (ctx.json) return ctx.emit.json(page);
  ctx.emit.table(
    ['标签', '状态', '槽', '分支', '提交', '配置版本', '创建时间'],
    page.items.map((release) => [
      release.tag, release.status, dash(release.slot), release.branch, shortSha(release.commitSha), dash(release.configVersion), shortTime(release.createdAt),
    ]),
  );
}

export async function showRelease(ctx: CommandContext): Promise<void> {
  const release = await ctx.client().services.getRelease(requiredArg(ctx, 0, 'releaseId'));
  if (ctx.json) return ctx.emit.json(release);
  ctx.emit.fields(releaseFields(release));
}

/** 两个部署槽的当前状态：哪个在线、各自跑着哪个 Release。 */
export async function showTraffic(ctx: CommandContext): Promise<void> {
  const api = ctx.client();
  const project = await resolveProject(api, requiredArg(ctx, 0, 'project'));
  const page = await api.services.listSlots(requireServiceId(project));
  if (ctx.json) return ctx.emit.json(page);
  ctx.emit.table(
    ['槽', '在线', '状态', '标签', '提交', '副本', '主机'],
    page.items.map((slot) => [
      slot.name, slot.active ? '←prod' : '', slot.state, dash(slot.tag), shortSha(slot.commitSha), `${slot.readyReplicas}/${slot.replicas}`, slot.host,
    ]),
  );
}

/** 切流与回退是同一个动作，只是目标槽不同；--expect 挡住迟到的切流覆盖已上线版本。 */
export async function switchTraffic(ctx: CommandContext): Promise<void> {
  const api = ctx.client();
  const project = await resolveProject(api, requiredArg(ctx, 0, 'project'));
  const expected = stringFlag(ctx, 'expect');
  const reason = stringFlag(ctx, 'reason');
  const input: TrafficSwitchRequest = {
    toSlot: enumFlag(ctx, 'to', SLOTS),
    ...(expected === undefined ? {} : { expectedActiveRelease: expected }),
    ...(reason === undefined ? {} : { reason }),
  } as TrafficSwitchRequest;
  const done = await api.services.switchTraffic(requireServiceId(project), input);
  if (ctx.json) return ctx.emit.json(done);
  ctx.emit.success(`prod 流量已从 ${done.fromSlot} 切到 ${done.toSlot}`);
  ctx.emit.fields([['Release', done.releaseId], ['执行人', done.actorUserId], ['原因', dash(done.reason)], ['时间', shortTime(done.createdAt)]]);
}

export async function trafficHistory(ctx: CommandContext): Promise<void> {
  const api = ctx.client();
  const project = await resolveProject(api, requiredArg(ctx, 0, 'project'));
  const page = await api.services.listTrafficSwitches(requireServiceId(project));
  if (ctx.json) return ctx.emit.json(page);
  ctx.emit.table(
    ['时间', '从', '到', 'Release', '执行人', '原因'],
    page.items.map((item) => [shortTime(item.createdAt), item.fromSlot, item.toSlot, item.releaseId, item.actorUserId, dash(item.reason)]),
  );
}

function releaseFields(release: ReleaseDto): readonly (readonly [string, string])[] {
  return [
    ['ID', release.id], ['标签', release.tag], ['状态', release.status], ['槽', dash(release.slot)],
    ['分支', release.branch], ['提交', release.commitSha], ['镜像', dash(release.image)],
    ['配置版本', dash(release.configVersion)], ['发布人', release.createdBy],
    ['创建时间', shortTime(release.createdAt)], ['更新时间', shortTime(release.updatedAt)], ['说明', dash(release.message)],
  ];
}
