import type { MessagesShapedLike } from '../../../shared/lib/i18n';
import type { settingsMessages as zhCN } from './settings.zh-CN';

export const settingsMessages: MessagesShapedLike<typeof zhCN> = {
  'admin.settings.hint': 'Platform-wide parameters. Saved values apply to every project immediately.',
  'admin.settings.autoOffline.title': 'Taking preview versions offline automatically',
  'admin.settings.autoOffline.description': 'The rollback target left behind by a traffic switch is kept for a while, and preview versions nobody opens are taken offline. The project owner is reminded first and can postpone.',
  'admin.settings.autoOffline.rollbackRetentionHours': 'Keep the rollback target',
  'admin.settings.autoOffline.idleOfflineDays': 'Preview version unused for',
  'admin.settings.autoOffline.reminderLeadHours': 'Remind in advance',
  'admin.settings.autoOffline.hint.rollbackRetentionHours': 'Hours, 1–8760. Counted from the traffic switch; opening it does not extend it.',
  'admin.settings.autoOffline.hint.idleOfflineDays': 'Days, 1–365. Counted from ready or the most recent visit.',
  'admin.settings.autoOffline.hint.reminderLeadHours': 'Hours, 1–720. Must be shorter than both periods above.',
  'admin.settings.autoOffline.range.rollbackRetentionHours': 'Enter a whole number of hours from 1 to 8760 for the rollback target.',
  'admin.settings.autoOffline.range.idleOfflineDays': 'Enter a whole number of days from 1 to 365 for the unused period.',
  'admin.settings.autoOffline.range.reminderLeadHours': 'Enter a whole number of hours from 1 to 720 for the reminder.',
  'admin.settings.autoOffline.leadVsRollback': 'The reminder must come earlier than the rollback target period.',
  'admin.settings.autoOffline.leadVsIdle': 'The reminder must come earlier than the unused period.',
  'admin.settings.autoOffline.hours': '{count} hours',
  'admin.settings.autoOffline.days': '{count} days',
  'admin.settings.autoOffline.defaults': 'Using the platform defaults; never changed.',
  'admin.settings.autoOffline.updatedAt': 'Last changed {time}.',
  'admin.settings.autoOffline.edit': 'Change',
  'admin.settings.autoOffline.save': 'Save',
  'admin.settings.autoOffline.saving': 'Saving…',
  'admin.settings.autoOffline.cancel': 'Cancel',
  'admin.settings.autoOffline.note': 'Shortening does not take already-expired versions offline at once: the owner is reminded first and the version goes offline only after the reminder period.',
  'admin.settings.autoOffline.saved': 'Saved. Every project’s deadlines are recalculated with the new periods.',
};
