import type { Messages } from '../../../shared/lib/i18n';

export const messages = {
  'admin.title': '管理员',
  'admin.line1': '管理员创建项目并指定项目负责人，接入公司系统（APIProxy／EventProducer 接入容器），维护开放策略并审批定向开放申请。',
  'admin.line2': '还负责套餐、任务容器 profile 与出站 FQDN 白名单。',
  'admin.emptyTitle': '管理功能尚未接入',
  'admin.emptyDescription': '项目创建、接入容器与审批队列随里程碑交付。',
} satisfies Messages;
