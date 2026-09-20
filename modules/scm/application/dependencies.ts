import type { Clock } from '@crewstation/kernel';
import type { GitLabGateway } from '../ports/gitLabGateway';
import type { GitRunner } from '../ports/gitRunner';
import type { ProjectAuthorizer } from '../ports/projectAuthorizer';
import type { ScmSettings } from '../ports/scmSettings';
import type { ScratchDirs } from '../ports/scratchDirs';
import type { TemplateSource } from '../ports/templateSource';
import type { UnitOfWork } from '../ports/unitOfWork';
import type { ManifestUpgrade } from '../ports/manifestUpgrade';

export interface ScmUseCaseDeps {
  manifestUpgrade?: ManifestUpgrade;
  uow: UnitOfWork;
  gitlab: GitLabGateway;
  git: GitRunner;
  templates: TemplateSource;
  scratch: ScratchDirs;
  authorizer: ProjectAuthorizer;
  settings: ScmSettings;
  clock: Clock;
}
