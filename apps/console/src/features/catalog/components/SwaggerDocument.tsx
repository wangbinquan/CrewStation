import { useState } from 'react';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { SwaggerSpecView } from './SwaggerSpecView';
import type { SwaggerInvocationContext } from './invocation/swaggerInvocationPlugin';

/** 后台目录刷新不能销毁输入；显式重新加载才安装新文档，旧文档暂停 Execute。 */
export function SwaggerDocument({ spec, proxy, invocation, readFailed }: { readonly spec: Record<string, unknown>; readonly proxy: string; readonly invocation: Omit<SwaggerInvocationContext, 'documentReady'>; readonly readFailed: boolean }) {
  const t = useT(), [displayed] = useState(spec);
  const changed = displayed !== spec;
  return <>
    {changed || readFailed ? <ActionNote tone="error">{t(changed ? 'catalog.swagger.documentChanged' : 'catalog.swagger.readFailed')}</ActionNote> : null}
    <SwaggerSpecView spec={displayed} proxy={proxy} invocation={{ ...invocation, documentReady: !readFailed && !changed }} />
  </>;
}
