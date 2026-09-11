import type { MessagesShapedLike } from '../../../shared/lib/i18n';
import type { messages as zhCN } from './zh-CN';

export const messages: MessagesShapedLike<typeof zhCN> = {
  'config.title': 'Config',
  'config.line1': 'Config and secrets are platform objects declared in the Manifest env section with a development and a production value set; production values are maintained by the project owner.',
  'config.line2': 'They are injected as environment variables into task containers and services, and versioned with each Release.',
  'config.emptyTitle': 'No config items',
  'config.emptyDescription': 'Once declared in the Manifest env section, items and both value sets are maintained here.',
};
