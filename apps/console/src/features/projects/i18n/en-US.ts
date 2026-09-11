import type { MessagesShapedLike } from '../../../shared/lib/i18n';
import type { messages as zhCN } from './zh-CN';

export const messages: MessagesShapedLike<typeof zhCN> = {
  'projects.list.title': 'Projects',
  'projects.list.line1': 'Projects are created by an administrator who assigns the project owner; one project holds one digital worker service, one hosted GitLab-compatible repository and one namespace.',
  'projects.list.line2': 'Pick a project to reach its overview, dev session, release, config, API catalog, events, logs and capabilities.',
  'projects.list.emptyTitle': 'No projects yet',
  'projects.list.emptyDescription': 'The project list appears here once the platform API is wired.',
  'projects.list.sampleLink': 'Open a sample project page (placeholder id: sample)',
  'projects.overview.title': 'Overview',
  'projects.overview.line1': 'preview and prod are the two blue/green deployment slots of ONE production service; they share the production database, files, identity and grants and differ only in where the gateway routes traffic.',
  'projects.overview.line2': 'A release is deployed to the standby preview slot first; the project owner switches traffic to production, and rollback switches it back.',
  'projects.slot.preview': 'preview slot',
  'projects.slot.previewRole': 'standby',
  'projects.slot.previewDescription': 'New releases land here first; project members and designated preview testers can reach it.',
  'projects.slot.prod': 'prod slot',
  'projects.slot.prodRole': 'production traffic',
  'projects.slot.prodDescription': 'The gateway routes user-domain traffic here; after a switch, rollback switches back.',
  'projects.slot.currentRelease': 'Current release',
  'projects.slot.unknown': '—',
  'projects.actions.publish': 'Publish',
  'projects.actions.publishHint': 'Entry points: workbench button, CLI and the operations MCP tool. The platform creates a v<major>.<minor>.<patch> tag, builds the fixed SHA, runs the migration and deploys to the preview slot.',
  'projects.actions.switchTraffic': 'Switch traffic',
  'projects.actions.switchTrafficHint': 'A TrafficSwitch by the project owner routes user-domain traffic to the new release; rollback switches back.',
  'projects.releases.title': 'Releases',
  'projects.releases.emptyTitle': 'No releases yet',
  'projects.releases.emptyDescription': 'Only a platform-created v<major>.<minor>.<patch> tag triggers a release; manual tags do nothing.',
};
