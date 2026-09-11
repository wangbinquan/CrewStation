import type { Messages } from '../../../shared/lib/i18n';

export const messages = {
  'catalog.title': '接口目录',
  'catalog.line1': '管理员以接入容器（APIProxy 项目）接入公司系统；发布后的代理按“代理名＋方法＋路径”登记操作，经 /api/<proxy>/ 前缀路由，标记为默认开放或定向开放（业务申请，管理员批准或拒绝并给出理由）。',
  'catalog.line2': '数字人也可把自己的 API 登记到同一目录；服务端裁剪后的 Swagger 内嵌在此，开发期试调用经开发容器发出，网关据此看到服务自身的身份。',
  'catalog.emptyTitle': '尚无可用接口',
  'catalog.emptyDescription': '已开放给本服务的操作与可申请定向开放的操作将在此列出。',
} satisfies Messages;
