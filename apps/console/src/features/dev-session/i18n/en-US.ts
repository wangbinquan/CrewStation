import type { MessagesShapedLike } from '../../../shared/lib/i18n';
import type { messages as zhCN } from './zh-CN';

export const messages: MessagesShapedLike<typeof zhCN> = {
  'devSession.title': 'Dev session',
  'devSession.line1': 'A project has at most one dev session at a time: one long-lived dev container with a resident TaskRunner (own UID), bound to the development database by default.',
  'devSession.line2': 'This page will host multiple parallel streaming agents, a web terminal, editor, preview, log page and publish controls; an idle session only triggers reminders.',
  'devSession.emptyTitle': 'No dev session',
  'devSession.emptyDescription': 'Once started, agent sessions, the terminal, the editor and the preview appear here.',
};
