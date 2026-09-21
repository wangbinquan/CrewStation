import { useQueryClient } from '@tanstack/react-query';
import type { ErrorComponentProps } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { errorMessage } from '../../shared/api/useApi';
import { useT } from '../../shared/lib/useT';
import { ActionNote } from '../../shared/ui/ActionNote';
import { Button } from '../../shared/ui/Button';
import { Stack } from '../../shared/ui/Stack';

/**
 * 路由的默认错误面板：页面在渲染期抛错时就地显示，外壳与导航留着。
 * 没有它时路由库不给各层路由装错误边界，任何一页的异常都会一路冒到根上，
 * 整个工作台被库自带的英文默认页顶掉（2026-09-21 网关页实撞）。
 */
export function RouteErrorPanel({ error, reset }: ErrorComponentProps): ReactElement {
  const t = useT(), queryClient = useQueryClient();
  // 出错页面的查询此刻都已无人订阅：连缓存一起丢掉再重画，否则重试读到的还是让它崩掉的那份数据。
  const retry = (): void => { queryClient.removeQueries({ type: 'inactive' }); reset(); };
  return (
    <Stack>
      <ActionNote tone="error">{t('ui.routeError.message', { message: errorMessage(error) })}</ActionNote>
      <p>{t('ui.routeError.hint')}</p>
      <Button onClick={retry}>{t('ui.routeError.retry')}</Button>
    </Stack>
  );
}
