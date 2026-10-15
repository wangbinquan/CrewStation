import { useNavigate } from '@tanstack/react-router';
import type { RefObject } from 'react';
import { CreateProjectForm } from '../CreateProjectForm';

export function SelfCreateProject({ open, onClose, returnFocusTo }: { open: boolean; onClose(): void; returnFocusTo?: RefObject<HTMLElement | null> }) {
  const navigate = useNavigate();
  return <CreateProjectForm scope="digital-worker" self open={open} onClose={onClose} returnFocusTo={returnFocusTo}
    onCreated={(project) => { onClose(); void navigate({ to: '/projects/$projectId/provisioning', params: { projectId: project.id } }); }} />;
}
