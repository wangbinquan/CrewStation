import type { MessagesShapedLike } from '../../../shared/lib/i18n';
import type { messages as zhCN } from './zh-CN';

export const messages: MessagesShapedLike<typeof zhCN> = {
  'events.title': 'Events',
  'events.line1': 'Company webhooks enter EventProducer projects over the service domain and become platform events handed to cs-events, which dedups, persists and pushes them with a source token and trace_id to the handler path of the active prod slot.',
  'events.line2': 'This page shows the subscriptions and delivery status of this service; v1 has no business-published custom events and no platform scheduler.',
  'events.emptyTitle': 'No event subscriptions',
  'events.emptyDescription': 'Subscriptions declared in the Manifest and the status of every delivery will appear here.',
};
