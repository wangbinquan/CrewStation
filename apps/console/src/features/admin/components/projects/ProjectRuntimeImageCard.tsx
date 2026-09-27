import { useState } from 'react';
import { ProjectRuntimeImagePolicyDtoSchema } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { useAdminPage } from '../../../../shared/admin/useAdminRead';
import { useT } from '../../../../shared/lib/useT';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { ProjectRuntimeImageForm } from './ProjectRuntimeImageForm';

export function ProjectRuntimeImageCard({ projectId, viewerId }: { readonly projectId: string; readonly viewerId: string }) {
  const t = useT(), [generation, setGeneration] = useState(0);
  const { query } = useAdminPage(['project-runtime-image-editor', projectId, generation], async () => {
    const policy = ProjectRuntimeImagePolicyDtoSchema.parse(await api.runtimeImages.projectPolicy(projectId));
    if (policy.projectId !== projectId) throw new Error(t('admin.directory.invalid'));
    const images = [];
    let before: string | undefined;
    for (;;) {
      const page = await api.runtimeImages.adminCatalog({ before, limit: 100 });
      images.push(...page.items);
      if (page.items.length < 100) break;
      const next = page.items.at(-1)!.id;
      if (before && next >= before) throw new Error(t('admin.directory.invalid'));
      before = next;
    }
    return { policy, images };
  });
  return <section aria-label={t('admin.projectImages.title')}>
    <QueryStatus isPending={query.isPending} error={query.error} />
    {query.data && !query.error ? <ProjectRuntimeImageForm key={generation} initial={query.data.policy} images={query.data.images} viewerId={viewerId} onReload={() => setGeneration((value) => value + 1)} /> : null}
  </section>;
}
