// 设计附件：只在本机服务静态原型，不连接平台或模型，不进入生产构建。
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = '/private/tmp/crewstation-rfc041-prototype';
const consoleRoot = resolve(import.meta.dir, '../../../../apps/console');
await mkdir(output, { recursive: true });
const result = await Bun.build({ entrypoints: [resolve(import.meta.dir, 'entry.tsx')], outdir: output, target: 'browser', plugins: [{ name: 'console-react', setup(build) {
  build.onResolve({ filter: /^react(?:-dom)?(?:\/|$)/ }, args => ({ path: require.resolve(args.path, { paths: [consoleRoot] }) }));
  build.onResolve({ filter: /^\/brand\// }, args => ({ path: args.path, external: true }));
} }] });
if (!result.success) { console.error(result.logs); process.exit(1); }
await copyFile(resolve(import.meta.dir, 'index.html'), resolve(output, 'index.html'));
console.log(`Built prototype: ${output}`);
if (process.argv.includes('--serve')) {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 51441, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/brand/crewstation-mark.svg') return new Response(Bun.file(resolve(consoleRoot, 'public/brand/crewstation-mark.svg')));
    if (!['/', '/index.html', '/entry.js', '/entry.css'].includes(path)) return new Response('Not found', { status: 404 });
    return new Response(Bun.file(resolve(output, path === '/' ? 'index.html' : path.slice(1))), { headers: { 'cache-control': 'no-store' } });
  } });
  console.log(`Review: ${server.url}`);
}
