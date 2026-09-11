// 静态资源服务：只在容器里用；未命中文件的路径回退到 index.html（SPA 路由）。不依赖任何工作区包。
const root = `${import.meta.dir}/dist`;
const port = Number(process.env.CS_CONSOLE_PORT ?? 8090);
const index = Bun.file(`${root}/index.html`);

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/healthz') return Response.json({ ok: true, service: 'console' });
    const file = Bun.file(`${root}${decodeURIComponent(url.pathname)}`);
    if (url.pathname !== '/' && (await file.exists())) {
      return new Response(file, { headers: { 'cache-control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' } });
    }
    return new Response(index, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
  },
});
console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: 'listening', service: 'console', port }));
