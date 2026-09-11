import type { Messages } from '../../../shared/lib/i18n';

export const messages = {
  'release.title': '发布',
  'release.line1': '发布是独立动作：只有平台创建的 v<major>.<minor>.<patch> 标签触发发布。平台推送当前分支、打标签、构建固定 SHA、对生产数据库执行与在线槽兼容的迁移，再部署到待机的 preview 槽。',
  'release.line2': '分支从下拉列表选择，列表显示每个分支落后两个槽的提交数；有未提交改动时只提示、不打标签。项目负责人切流，回滚即切回。',
  'release.emptyTitle': '尚无发布记录',
  'release.emptyDescription': '每次发布的标签、构建、迁移与部署状态将在此显示。',
} satisfies Messages;
