import type { MessagesShapedLike } from '../../../shared/lib/i18n';
import type { messages as zhCN } from './zh-CN';

export const messages: MessagesShapedLike<typeof zhCN> = {
  'catalog.title': 'API catalog',
  'catalog.line1': 'Administrators integrate company systems as APIProxy projects; released proxies register operations keyed by proxy name + method + path, routed by the /api/<proxy>/ prefix and marked default-open or targeted-open (business requests, administrator approves or rejects with a reason).',
  'catalog.line2': 'Digital workers may register their own APIs in the same catalog; the server-side pruned Swagger is embedded here, and dev-time test calls go out through the dev container so the gateway sees the service identity.',
  'catalog.emptyTitle': 'No operations available',
  'catalog.emptyDescription': 'Operations open to this service and operations available for a targeted-open request will be listed here.',
};
