import type { CreationTemplates, RoleMutationLock } from '../ports/creation';
import type { Clock } from '@crewstation/kernel';
import type { HostNaming } from '../ports/hostNaming';
import type { ProjectSettings } from '../ports/projectSettings';
import type { TaskUsage } from '../ports/taskUsage';
import type { UnitOfWork } from '../ports/unitOfWork';
import type { UserDirectory } from '../ports/userDirectory';

export interface ProjectUseCaseDeps {
  uow: UnitOfWork;
  roleLock: RoleMutationLock;
  creationTemplates: CreationTemplates;
  users: UserDirectory;
  hosts: HostNaming;
  settings: ProjectSettings;
  taskUsage: TaskUsage;
  clock: Clock;
}
