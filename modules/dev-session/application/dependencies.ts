import type { Clock, Logger } from '@crewstation/kernel';
import type { DevSessionSettings, ManifestParser, Notifier, ProjectAuthorizer, Releases, ServiceResolver, SourceControl } from '../ports/platform';
import type { Environments, ReminderRepository, Runner } from '../ports/runtime';

export interface DevSessionUseCaseDeps {
  environments: Environments;
  runner: Runner;
  scm: SourceControl;
  releases: Releases;
  manifests: ManifestParser;
  authorizer: ProjectAuthorizer;
  services: ServiceResolver;
  notifier: Notifier;
  reminders: ReminderRepository;
  settings: DevSessionSettings;
  clock: Clock;
  logger: Logger;
}
