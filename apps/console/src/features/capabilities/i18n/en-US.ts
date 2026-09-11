import type { MessagesShapedLike } from '../../../shared/lib/i18n';
import type { messages as zhCN } from './zh-CN';

export const messages: MessagesShapedLike<typeof zhCN> = {
  'capabilities.title': 'Capabilities',
  'capabilities.line1': 'An aggregate of what this service can use right now: granted API operations, data resource bindings, event subscriptions, the concurrent-task quota and the service plan.',
  'capabilities.line2': 'It matches what the capability-description MCP gives agents, plus the business integration convention table.',
  'capabilities.emptyTitle': 'No capability data',
  'capabilities.emptyDescription': 'The aggregate view appears once the public queries of the modules are wired.',
};
