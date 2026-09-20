// 独立设计附件；不连接真实 API，不进入生产构建。
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = '/private/tmp/crewstation-role-home-rfc011';
const consoleRoot = resolve(import.meta.dir, '../../../../apps/console');
await mkdir(output, { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve(import.meta.dir, 'entry.tsx')], outdir: output, target: 'browser',
  plugins: [{ name: 'console-react', setup(build) {
    build.onResolve({ filter: /^react(?:-dom)?(?:\/|$)/ }, (args) => ({ path: require.resolve(args.path, { paths: [consoleRoot] }) }));
    build.onResolve({ filter: /^\/brand\// }, (args) => ({ path: args.path, external: true }));
  } }],
});
if (!result.success) { console.error(result.logs); process.exit(1); }
await copyFile(resolve(import.meta.dir, 'index.html'), resolve(output, 'index.html'));
await copyFile(resolve(import.meta.dir, 'responsive.html'), resolve(output, 'responsive.html'));
console.log(`Built design preview: ${output}`);
if (process.argv.includes('--serve')) {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 5201, fetch(request) {
    const file = new URL(request.url).pathname;
    if (['/brand/crewstation-mark.svg', '/brand/crewstation-mark-mono.svg'].includes(file)) return new Response(Bun.file(resolve(consoleRoot, 'public', file.slice(1))));
    if (!['/', '/index.html', '/responsive.html', '/entry.js', '/entry.css'].includes(file)) return new Response('Not found', { status: 404 });
    return new Response(Bun.file(resolve(output, file === '/' ? 'index.html' : file.slice(1))));
  } });
  console.log(`Design preview: ${server.url}`);
}
