import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import 'swagger-ui-dist/swagger-ui.css';
import styles from './SwaggerPanel.module.css';
import { createSwaggerInvocationPlugin } from './invocation/swaggerInvocationPlugin';
import type { SwaggerInvocationContext } from './invocation/swaggerInvocationPlugin';
import { errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';

export interface SwaggerSpecViewProps {
  /** 服务端裁剪后的 OpenAPI 文档；直接给 spec，不让 Swagger UI 自己去取文档。 */
  readonly spec: Record<string, unknown>;
  readonly proxy: string;
  readonly invocation: SwaggerInvocationContext;
}

interface SwaggerInstance { getConfigs: () => { supportedSubmitMethods: string[] }; configsActions: { update: (name: string, value: string[]) => void } }
const SUBMIT_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** 参数与运行结果更新不重建 Swagger；事件始终读取最新授权、固定会话和输入锁。 */
export function SwaggerSpecView({ spec, proxy, invocation }: SwaggerSpecViewProps): ReactElement {
  const t = useT(), host = useRef<HTMLDivElement>(null), [loadError, setLoadError] = useState<string>();
  const latest = useRef({ invocation, t });
  const instance = useRef<SwaggerInstance>(undefined);
  useLayoutEffect(() => { latest.current = { invocation, t }; }, [invocation, t]);
  useLayoutEffect(() => {
    if (!instance.current) return;
    instance.current.getConfigs().supportedSubmitMethods = invocation.canDevelop ? SUBMIT_METHODS : [];
    instance.current.configsActions.update('supportedSubmitMethods', invocation.canDevelop ? SUBMIT_METHODS : []);
  }, [invocation.canDevelop]);
  useEffect(() => {
    const node = host.current;
    if (node === null) return;
    let disposed = false;
    // 只在文档真正展开后加载自带 React 的 bundle，避免其他页面也初始化它。
    void import('swagger-ui-dist').then(({ SwaggerUIBundle }) => {
      if (disposed) return;
      instance.current = SwaggerUIBundle({
        domNode: node, spec, supportedSubmitMethods: latest.current.invocation.canDevelop ? SUBMIT_METHODS : [],
        tryItOutEnabled: false, deepLinking: false, docExpansion: 'list', displayRequestDuration: false, showMutatedRequest: false, validatorUrl: null,
        plugins: [createSwaggerInvocationPlugin(proxy, () => latest.current.invocation, (key, values) => latest.current.t(key, values))],
      });
    }).catch((failure: unknown) => { if (!disposed) setLoadError(errorMessage(failure)); });
    return () => {
      // 卸载时清空容器：Swagger UI 没有 dispose，重复挂载会叠加出多份文档。
      disposed = true;
      instance.current = undefined;
      node.replaceChildren();
    };
  }, [spec, proxy]);
  return <>{loadError ? <ActionNote tone="error">{t('catalog.swagger.loadBundleError', { message: loadError })}</ActionNote> : null}<div ref={host} className={styles.swagger} /></>;
}
