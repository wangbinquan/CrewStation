import type { CapabilityDescriptionDto } from '@crewstation/contracts';
import type { ReactElement, ReactNode } from 'react';
import { errorMessage } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { useProjectScope } from '../../../../shared/project/ProjectScope';
import { Button } from '../../../../shared/ui/Button';
import { EmptyState } from '../../../../shared/ui/EmptyState';
import { useCapabilityDescription } from '../../model/useCapabilityDescription';
import { AgentTools } from './AgentTools';
import { EventHeaders } from './EventHeaders';
import { RuntimeReference } from './RuntimeReference';
import styles from './Reference.module.css';

/** 三个主题共用同一份能力说明：读取中、失败可重试都留在当前主题。 */
function WithDescription({ render }: { readonly render: (description: CapabilityDescriptionDto) => ReactNode }): ReactElement {
  const t = useT(), { projectId } = useProjectScope(), description = useCapabilityDescription(projectId);
  if (description.isPending) return <p className={styles.muted}>{t('capabilities.loading')}</p>;
  if (description.error || !description.data) return <><EmptyState title={t('capabilities.error', { message: errorMessage(description.error) })} /><div><Button onClick={() => { void description.refetch(); }}>{t('capabilities.retry')}</Button></div></>;
  return <>{render(description.data)}</>;
}

/** 「运行环境」主题。 */
export function RuntimeTopic({ configAction }: { readonly configAction?: ReactNode }): ReactElement {
  return <WithDescription render={(description) => <RuntimeReference description={description} configAction={configAction} />} />;
}

/** 「Agent 工具」主题。 */
export function AgentToolsTopic(): ReactElement {
  return <WithDescription render={(description) => <AgentTools mcp={description.mcp} />} />;
}

/** 「接收事件」里的事件请求头组；读不到时不挡住订阅与类型列表。 */
export function EventHeadersTopic(): ReactElement | null {
  const { projectId } = useProjectScope(), description = useCapabilityDescription(projectId);
  return description.data ? <EventHeaders conventions={description.data.conventions} /> : null;
}

/** 「调用接口」里平台自己的接口（业务子任务）；读不到时为空，不挡住目录。 */
export function usePlatformEndpoints(): CapabilityDescriptionDto['businessTaskApi'] | undefined {
  const { projectId } = useProjectScope();
  return useCapabilityDescription(projectId).data?.businessTaskApi;
}
