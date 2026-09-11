import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { SwaggerUIBundle } from 'swagger-ui-dist';
import 'swagger-ui-dist/swagger-ui.css';
import styles from './SwaggerPanel.module.css';

export interface SwaggerSpecViewProps {
  /** 服务端裁剪后的 OpenAPI 文档；直接给 spec，不让 Swagger UI 自己去取文档。 */
  readonly spec: Record<string, unknown>;
}

/**
 * 内嵌 Swagger UI。
 * supportedSubmitMethods 置空并关掉 tryItOut：开发期试调用必须经开发容器发出，
 * 浏览器直接发请求会让网关看到用户身份而不是服务身份，因此这里只读文档。
 */
export function SwaggerSpecView({ spec }: SwaggerSpecViewProps): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = host.current;
    if (node === null) return;
    SwaggerUIBundle({ domNode: node, spec, supportedSubmitMethods: [], tryItOutEnabled: false, deepLinking: false, docExpansion: 'list' });
    return () => {
      // 卸载时清空容器：Swagger UI 没有 dispose，重复挂载会叠加出多份文档。
      node.replaceChildren();
    };
  }, [spec]);
  return <div ref={host} className={styles.swagger} />;
}
