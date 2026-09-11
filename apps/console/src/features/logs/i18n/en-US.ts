import type { MessagesShapedLike } from '../../../shared/lib/i18n';
import type { messages as zhCN } from './zh-CN';

export const messages: MessagesShapedLike<typeof zhCN> = {
  'logs.title': 'Logs',
  'logs.line1': 'Logs of the service and its task containers are aggregated on this page, next to deployment health and project-level alert subscriptions.',
  'logs.line2': 'Requests blocked by the egress FQDN allowlist are visible here too.',
  'logs.emptyTitle': 'No logs',
  'logs.emptyDescription': 'Once log aggregation is wired, entries can be filtered by deployment slot and task.',
};
