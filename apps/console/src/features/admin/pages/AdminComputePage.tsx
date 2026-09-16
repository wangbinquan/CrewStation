import { useNavigate, useSearch } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Tabs } from '../../../shared/ui/Tabs';
import { ComputeProfilesSection } from '../components/ComputeProfilesSection';
import { RuntimeConfigEditor } from '../components/runtime/RuntimeConfigEditor';
import { RuntimeConfigsSection } from '../components/runtime/RuntimeConfigsSection';
import type { ComputeSearch } from '../model/computeSearch';
import { parseComputeSearch } from '../model/computeSearch';
import { AdminSection } from './AdminSection';

/** 算力页：算力档位（RFC-001）与运行环境（RFC-004）两个页签；页签与打开的环境都在查询串里，可直达、可返回。 */
export function AdminComputePage(): ReactElement {
  const t = useT(), navigate = useNavigate(), search = parseComputeSearch(useSearch({ strict: false }));
  const go = (next: ComputeSearch) => void navigate({ to: '/admin/compute', search: next });
  return (
    <AdminSection title={t('nav.admin.compute')} description={t('admin.compute.pageHint')}>
      <Tabs label={t('nav.admin.compute')} value={search.tab} onChange={(tab) => go({ tab: tab as ComputeSearch['tab'] })}
        items={[{ value: 'profiles', label: t('admin.compute.tab.profiles') }, { value: 'runtime', label: t('admin.compute.tab.runtime') }]}>
        {search.tab === 'profiles' ? <ComputeProfilesSection onOpenRuntime={(config) => go({ tab: 'runtime', config })} />
          : search.config !== undefined ? <RuntimeConfigEditor key={search.config} configId={search.config} onClose={() => go({ tab: 'runtime' })} />
          : <RuntimeConfigsSection onOpen={(config) => go({ tab: 'runtime', config })} />}
      </Tabs>
    </AdminSection>
  );
}
