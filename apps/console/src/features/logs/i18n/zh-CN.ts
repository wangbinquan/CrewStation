import type { Messages } from '../../../shared/lib/i18n';

export const messages = {
  'logs.title': '日志',
  'logs.line1': '服务与任务容器的日志集中聚合到此页；同时显示部署健康态与项目级告警订阅。',
  'logs.line2': '被出站 FQDN 白名单拦截的请求也在这里可见。',
  'logs.emptyTitle': '尚无日志',
  'logs.emptyDescription': '日志聚合接入后，可按部署槽与任务筛选。',
} satisfies Messages;
