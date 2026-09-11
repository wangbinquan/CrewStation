import type { MessagesShapedLike } from '../../shared/lib/i18n';
import type { messages as zhCN } from './zh-CN';

export const messages: MessagesShapedLike<typeof zhCN> = {
  'app.brand': 'CrewStation',
  'app.workbench': 'Workbench',
  'nav.aria': 'Main navigation',
  'nav.platform': 'Platform',
  'nav.projects': 'Projects',
  'nav.admin': 'Administrator',
  'nav.currentProject': 'Current project',
  'nav.overview': 'Overview',
  'nav.devSession': 'Dev session',
  'nav.release': 'Release',
  'nav.config': 'Config',
  'nav.catalog': 'API catalog',
  'nav.events': 'Events',
  'nav.logs': 'Logs',
  'nav.capabilities': 'Capabilities',
  'topBar.project': 'Project {projectId}',
  'topBar.userPlaceholder': 'Current user (placeholder)',
  'topBar.userHint': 'Login and identity injection happen at the gateway (cs-auth) on the user domain; the workbench has no login code. The real user appears here once wired.',
  'locale.label': 'Language',
  'locale.zh-CN': '中文',
  'locale.en-US': 'English',
  'notFound.title': 'Page not found',
  'notFound.description': 'This address does not match any workbench page.',
  'notFound.backToProjects': 'Back to projects',
};
