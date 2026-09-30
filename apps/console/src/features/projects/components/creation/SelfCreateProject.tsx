import { useState } from 'react';
import type { RefObject } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Dialog } from '../../../../shared/ui/dialog/Dialog';
import { CreateProjectForm } from '../CreateProjectForm';
import { ProjectProvisioningPage } from '../../pages/ProjectProvisioningPage';

export function SelfCreateProject({ open, onClose, returnFocusTo }: { open: boolean; onClose(): void; returnFocusTo?: RefObject<HTMLElement | null> }) {
  const t = useT(), [created, setCreated] = useState<string>();
  return <>
    <CreateProjectForm scope="digital-worker" self open={open} onClose={onClose} returnFocusTo={returnFocusTo} onCreated={(project) => { onClose(); setCreated(project.id); }} />
    {created ? <Dialog title={t('projects.provision.title')} size="large" onClose={() => setCreated(undefined)} returnFocusTo={returnFocusTo}>
      <ProjectProvisioningPage projectId={created} />
    </Dialog> : null}
  </>;
}
