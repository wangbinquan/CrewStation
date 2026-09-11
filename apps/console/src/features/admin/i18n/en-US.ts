import type { MessagesShapedLike } from '../../../shared/lib/i18n';
import type { messages as zhCN } from './zh-CN';

export const messages: MessagesShapedLike<typeof zhCN> = {
  'admin.title': 'Administrator',
  'admin.line1': 'Administrators create projects and assign owners, integrate company systems (APIProxy / EventProducer projects), maintain the open policy and approve targeted-open requests.',
  'admin.line2': 'They also own service plans, task container profiles and the egress FQDN allowlist.',
  'admin.emptyTitle': 'Administration not wired yet',
  'admin.emptyDescription': 'Project creation, integration projects and the approval queue arrive with their milestones.',
};
