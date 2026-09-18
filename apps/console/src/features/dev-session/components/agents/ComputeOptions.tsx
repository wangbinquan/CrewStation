import type { ComputeProfileSummaryDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import type { Translate } from '../../../../shared/lib/useT';
import type { ChoiceBlock } from '../../model/computeChoices';

/**
 * 档位下拉的选项（RFC-006）：首项是「默认档位」（启动时由服务端解析，C17），其后是可列的档位；
 * 通用终端档位标「仅终端」，不可用的档位禁选并写出原因。租户面只见档位名与说明，不见镜像、二进制与模型。
 */
export function ComputeOptions({ items, withDescription = false }: { readonly items: readonly ComputeProfileSummaryDto[]; readonly withDescription?: boolean }): ReactElement {
  const t = useT();
  const fallback = items.find((item) => item.isDefault);
  const label = (item: ComputeProfileSummaryDto) => {
    const name = `${item.name}${item.terminalOnly ? ` · ${t('devSession.agents.terminalOnly')}` : ''}`;
    if (!item.available) return t('devSession.agents.computeUnavailable', { name, reason: item.reason ?? '' });
    return withDescription && item.description ? `${name} · ${item.description}` : name;
  };
  return (
    <>
      <option value="">{fallback ? t('devSession.agents.computeDefaultNamed', { name: fallback.name }) : t('devSession.agents.computeNoDefault')}</option>
      {items.map((item) => <option key={item.name} value={item.name} disabled={!item.available}>{label(item)}</option>)}
    </>
  );
}

/** 不能启动时的一句说明；原因对租户可理解，处理人指向管理员。 */
export function computeBlockText(t: Translate, block: ChoiceBlock | undefined, target: ComputeProfileSummaryDto | undefined): string | undefined {
  if (block === 'no-default') return t('devSession.agents.computeNoDefaultHint');
  if (block === 'missing') return t('devSession.agents.computeMissingHint');
  if (block === 'unavailable') return t('devSession.agents.computeUnavailableReason', { name: target?.name ?? '', reason: target?.reason ?? '' });
  return undefined;
}
