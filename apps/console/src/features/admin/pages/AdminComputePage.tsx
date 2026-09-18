import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { ComputeProfileEditor } from '../components/compute/ComputeProfileEditor';
import { ComputeProfilesSection } from '../components/compute/ComputeProfilesSection';
import { RuntimeImagesCard } from '../components/compute/RuntimeImagesCard';
import type { ComputeSearch } from '../model/computeSearch';
import { parseComputeSearch } from '../model/computeSearch';
import { AdminSection } from './AdminSection';

/**
 * 算力页（RFC-006）：只有一张档位表——运行环境已并入档位。打开的档位与新建页都在查询串里，可直达、可返回；
 * 列表与编辑页下方都是平台仓库与底座镜像的推送信息（镜像要先推进平台仓库，档位才能引用）。
 */
export function AdminComputePage(): ReactElement {
  const t = useT(), navigate = useNavigate(), search = parseComputeSearch(useSearch({ strict: false }));
  const go = useCallback((next: ComputeSearch) => void navigate({ to: '/admin/compute', search: next }), [navigate]);
  const openProfile = useCallback((name: string) => go({ profile: name }), [go]);
  const editing = search.profile !== undefined || search.create === true;
  return (
    <AdminSection title={t('nav.admin.compute')} description={t('admin.profile.pageHint')}>
      {editing ? <ComputeProfileEditor {...(search.profile === undefined ? {} : { name: search.profile })} onClose={() => go({})} onCreated={openProfile} />
        : <ComputeProfilesSection onOpen={openProfile} onCreate={() => go({ create: true })} />}
      {/* 列表与编辑页同一位置：切换时卡片不重挂，刚签发的一次性凭据不会因为打开编辑页而消失。 */}
      <RuntimeImagesCard />
    </AdminSection>
  );
}
