import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Route {
  kind: string;
  metadata: { name: string };
  spec: {
    entryPoints: string[];
    tls?: object;
    routes: Array<{ match: string; middlewares: Array<{ name: string }>; services: Array<{ name: string; port: number }> }>;
  };
}
const routes = (Bun.YAML.parse(readFileSync(join(import.meta.dir, '41-registry-gateway.yaml'), 'utf8')) as Route[])
  .filter((doc) => doc.kind === 'IngressRoute');

test('工作机与构建 Pod 的仓库域名在 HTTP 和 HTTPS 都经鉴权代理', () => {
  // 真实 BuildKit 推送优先 HTTPS；遗漏内部域名会在安装成功后以 Traefik 404 失败。
  for (const entryPoint of ['web', 'websecure']) {
    const ingress = routes.find((route) => route.spec.entryPoints.includes(entryPoint))!;
    expect(ingress).toBeDefined();
    if (entryPoint === 'websecure') expect(ingress.spec.tls).toBeDefined();
    for (const host of ['registry.cs.localhost', 'registry-push.svc.cs.internal']) {
      const route = ingress.spec.routes.find((item) => item.match.includes(`Host(\`${host}\`)`));
      expect(route).toBeDefined();
      expect(route?.middlewares).toEqual([{ name: 'forward-auth-registry' }]);
      expect(route?.services).toEqual([{ name: 'registry', port: 5000 }]);
    }
  }
});
