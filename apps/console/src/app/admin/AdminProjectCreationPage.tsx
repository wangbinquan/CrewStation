import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { ProjectIdSchema } from '@crewstation/contracts';
import { CreateProjectForm, ProjectProvisioningPage } from '../../features/projects';
import { ProjectCreationProvider } from '../../shared/admin/ProjectCreationSlot';
import { useT } from '../../shared/lib/useT';
import { ActionNote } from '../../shared/ui/ActionNote';
import { Dialog } from '../../shared/ui/dialog/Dialog';

/** 列表入口发意图，app 层组合两 feature 的公共出口；成功也留在原列表。 */
export function AdminProjectCreationProvider({ children }: { children: ReactNode }) {
  const t = useT(), [created, setCreated] = useState<string>();
  return <ProjectCreationProvider renderDialog={(slot) => <>
    <CreateProjectForm key={slot.scope} {...slot} onCreated={(project) => { slot.onClose(); setCreated(project.id); }} />
    {created ? <Dialog title={t('projects.provision.title')} size="large" onClose={() => setCreated(undefined)} returnFocusTo={slot.returnFocusTo}>
      <ProjectProvisioningPage projectId={created} />
    </Dialog> : null}
  </>}>{children}</ProjectCreationProvider>;
}

export function AdminProjectProvisioningPage() {
  const t = useT(), { projectId } = useParams({ strict: false });
  if (!ProjectIdSchema.safeParse(projectId).success) return <ActionNote tone="error">{t('projects.provision.invalidProject')}</ActionNote>;
  return <ProjectProvisioningPage key={projectId} projectId={projectId!} />;
}
