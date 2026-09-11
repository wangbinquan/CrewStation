import type { MessagesShapedLike } from '../../../shared/lib/i18n';
import type { messages as zhCN } from './zh-CN';

export const messages: MessagesShapedLike<typeof zhCN> = {
  'logs.title': 'Logs',
  'logs.line1': 'Logs of the service and its task containers are aggregated on this page, next to the health of both deployment slots.',
  'logs.line2': 'Fetch one page by source and slot, then filter inside it by keyword; with Follow on, the newest page is refetched every 5s.',

  'logs.status.loading': 'Loading…',
  'logs.status.error': 'Could not load: {message}',
  'logs.none': '—',

  'logs.health.title': 'Deployment health',
  'logs.health.replicas': 'Ready replicas',
  'logs.health.restarts': 'Restarts',
  'logs.health.lastTransitionAt': 'Last change',
  'logs.health.emptyTitle': 'No health data',
  'logs.health.emptyDescription': 'Once the service is released to a slot, each slot reports its replicas and health state here.',
  'logs.healthState.healthy': 'Healthy',
  'logs.healthState.degraded': 'Degraded',
  'logs.healthState.crash-looping': 'Crash looping',
  'logs.healthState.unhealthy': 'Unhealthy',
  'logs.healthState.unknown': 'Unknown',

  'logs.filters.source': 'Source',
  'logs.filters.slot': 'Slot',
  'logs.filters.slotAll': 'All',
  'logs.filters.limit': 'Page size',
  'logs.filters.text': 'Filter',
  'logs.filters.textPlaceholder': 'Filter within this page',
  'logs.filters.slotHint': 'Only applies when the source is a deployment slot.',
  'logs.source.slot': 'Deployment slot',
  'logs.source.dev-session': 'Dev session',
  'logs.source.business-task': 'Business task',
  'logs.source.build': 'Build',
  'logs.source.migration': 'Migration',
  'logs.slot.preview': 'preview',
  'logs.slot.prod': 'prod',

  'logs.follow.on': 'Following',
  'logs.follow.off': 'Follow',
  'logs.follow.hint': 'While following, the newest page is refetched every 5s and kept scrolled to the bottom; scrolling up pauses the auto-pin.',

  'logs.list.title': 'Log tail',
  'logs.list.count': '{shown} of {total} on this page',
  'logs.list.emptyTitle': 'No log entries',
  'logs.list.emptyDescription': 'Try another source or slot; if the endpoint is not wired yet you will see a load error instead.',
  'logs.list.noMatchTitle': 'Nothing matches on this page',
  'logs.list.noMatchDescription': 'The keyword only filters the page already fetched; clear it to see every line.',

  'logs.pager.older': 'Older page',
  'logs.pager.newer': 'Newer page',
  'logs.pager.newest': 'Back to newest',
  'logs.pager.followingHint': 'Following pins you to the newest page; turn it off to page back.',

  'logs.level.error': 'ERROR',
  'logs.level.warn': 'WARN',
  'logs.level.info': 'INFO',
  'logs.level.debug': 'DEBUG',
};
