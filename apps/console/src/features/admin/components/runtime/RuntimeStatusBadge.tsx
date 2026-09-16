import type { RuntimeConfigStatus } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import type { BadgeTone } from '../../../../shared/ui/Badge';

/** 已启用绿、检查通过蓝、检查失败红、已停用黄（还能恢复）、草稿灰。 */
export function runtimeStatusTone(status: RuntimeConfigStatus): BadgeTone {
  if (status === 'active') return 'success';
  if (status === 'checked') return 'info';
  if (status === 'check-failed') return 'danger';
  return status === 'disabled' ? 'warning' : 'neutral';
}

export function RuntimeStatusBadge({ status }: { readonly status: RuntimeConfigStatus }): ReactElement {
  const t = useT();
  return <Badge tone={runtimeStatusTone(status)}>{t(`admin.runtime.status.${status}`)}</Badge>;
}
