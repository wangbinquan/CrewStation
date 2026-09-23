import type { AgentPermission, WorkspaceLayout } from '@crewstation/contracts';
import { useCallback, useState } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { computeBlockText } from '../../components/agents/ComputeOptions';
import { choiceBlocked, choicesFor, resolveChoice } from '../../model/computeChoices';
import { LAYOUT_TERMINALS } from '../../model/layout/terminalGroups';
import type { WorkspaceLayoutStore } from '../../model/layout/workspaceLayoutStore';
import type { useNativeTerminals } from './useNativeTerminals';

/**
 * 新开一个 CLI 的全部判断，页头的拆分按钮与空白 CLI 区的按钮共用：主键按记住的档位（个人布局）与权限（本页）直接创建；
 * 环境未就绪、正在创建、档位读取中或失败、布局已满时主键与展开一起不可用；只有所选档位被阻断时展开仍可用——换档位要靠它。
 */
export function useCliLauncher(projectId: string, layout: WorkspaceLayout, store: WorkspaceLayoutStore, native: ReturnType<typeof useNativeTerminals>, canStart: boolean) {
  const t = useT();
  const profiles = useApiQuery(queryKeys.computeProfiles(projectId), () => api.catalog.listComputeProfiles(projectId));
  const compute = layout.preferredCompute ?? '';
  // 列出全部档位（含仅终端的通用终端协议，RFC-006 C6）；选中的档位不可用、平台没设默认档位时不许启动：服务端会拒绝，前端先把原因摆出来。
  const items = choicesFor(profiles.data?.items ?? [], 'cli');
  const block = profiles.data === undefined ? undefined : choiceBlocked(items, compute);
  const blockText = computeBlockText(t, block, resolveChoice(items, compute));
  const [permission, setPermission] = useState<AgentPermission>('edit');
  const starting = native.start.isPending || native.retryingOriginal;
  const full = layout.tabs.reduce((sum, tab) => sum + tab.paneOrder.length, 0) + layout.hiddenTerminalIds.length >= LAYOUT_TERMINALS;
  const unavailable = !canStart || native.start.isPending || profiles.isPending || profiles.isError || full;
  const { launch: start } = native;
  const launch = useCallback(() => start(compute, permission), [start, compute, permission]);
  const setCompute = useCallback((value: string) => store.update((current) => ({ ...current, preferredCompute: value || undefined })), [store]);
  const label = t(native.start.isPending ? 'devSession.agents.starting' : native.retryingOriginal ? 'devSession.native.retryStart' : 'devSession.native.add');
  return { profiles, items, compute, setCompute, permission, setPermission, block, blockText, starting, full, unavailable, disabled: unavailable || block !== undefined, launch, label };
}

export type CliLauncher = ReturnType<typeof useCliLauncher>;
