import { DialogVisibility } from '../../../shared/ui/dialog/DialogHost';
import { Tabs } from '../../../shared/ui/Tabs';
import { TokenPricingSection } from '../components/computePricing/TokenPricingSection';
import { useComputeListReturn } from '../hooks/useComputeListReturn';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { ComputeProfileEditor } from '../components/compute/ComputeProfileEditor';
import { ComputeProfilesSection } from '../components/compute/ComputeProfilesSection';
import { RuntimeImagesCard } from '../components/compute/RuntimeImagesCard';
import type { ComputeSearch } from '../model/computeSearch';
import { parseComputeSearch } from '../model/computeSearch';
import { CatalogPage } from '../../../shared/ui/catalog/CatalogPage';
import catalogStyles from '../../../shared/ui/CapabilityCatalog.module.css';

/**
 * 算力页（RFC-006）：只有一张档位表——运行环境已并入档位。打开的档位与新建页都在查询串里，可直达、可返回；
 * 列表与编辑页下方都是平台仓库与底座镜像的推送信息（镜像要先推进平台仓库，档位才能引用）。
 */
export function AdminComputePage(): ReactElement {
  const t = useT(), navigate = useNavigate(), search = parseComputeSearch(useSearch({ strict: false }));
  const go = useCallback((next: ComputeSearch) => void navigate({ to: '/admin/compute', search: { q: search.q, ...next }, resetScroll: false }), [navigate, search.q]);
  const editing = search.profile !== undefined || search.create === true, remember = useComputeListReturn(editing);
  const openProfile = (name: string) => { remember(name); go({ profile: name }); };
  return (
    <CatalogPage title={t('nav.admin.compute')} description={t(editing ? 'admin.profile.editor.pageHint' : 'admin.profile.pageHint')}>
      <Tabs label={t('nav.admin.compute')} value={search.tab ?? 'profiles'} items={[{ value: 'profiles', label: t('admin.pricing.profiles') }, { value: 'pricing', label: t('admin.pricing.title') }]} onChange={(tab) => go(tab === 'pricing' ? { tab: 'pricing' } : {})}>
      <div className={catalogStyles.catalogSections}>
      {search.tab === 'pricing' ? <TokenPricingSection search={search.q ?? ''} onSearch={(q) => go({ tab: 'pricing', q })} /> : editing ? <ComputeProfileEditor {...(search.profile === undefined ? {} : { name: search.profile })} onClose={() => go({})} onCreated={openProfile} />
        : <ComputeProfilesSection onOpen={openProfile} onCreate={() => { remember(); go({ create: true }); }} search={search.q ?? ''} onSearch={(q) => go({ q })} />}
      {/* 列表与编辑页同一位置：切换时卡片不重挂，刚签发的一次性凭据不会因为打开编辑页而消失。 */}
      <DialogVisibility hidden={search.tab === 'pricing'}><div hidden={search.tab === 'pricing'}><RuntimeImagesCard /></div></DialogVisibility>
      </div>
      </Tabs>
    </CatalogPage>
  );
}
