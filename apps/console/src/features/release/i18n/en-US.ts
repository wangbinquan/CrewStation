import type { MessagesShapedLike } from '../../../shared/lib/i18n';
import type { messages as zhCN } from './zh-CN';

export const messages: MessagesShapedLike<typeof zhCN> = {
  'release.title': 'Release',
  'release.line1': 'Publishing is a separate action: only a platform-created v<major>.<minor>.<patch> tag triggers a release. The platform pushes the current branch, tags it, builds the fixed SHA, runs a migration compatible with the serving slot, then deploys to the standby preview slot.',
  'release.line2': 'The branch is picked from a dropdown showing how far each branch lags behind both slots; uncommitted changes only prompt and create no tag. The project owner switches traffic; rollback switches back.',
  'release.emptyTitle': 'No releases yet',
  'release.emptyDescription': 'The tag, build, migration and deployment status of every release will appear here.',
};
