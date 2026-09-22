// 独立设计附件；不连接真实 API，不进入生产构建。用法：bun run proposal/rfc/RFC-019-deployment-topology/prototype/preview.ts --serve
import { mkdir, copyFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = '/private/tmp/crewstation-deployment-topology-rfc019';
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
for (const file of ['index.html', 'responsive.html']) await copyFile(resolve(import.meta.dir, file), resolve(output, file));
// Archify 对照图：由本目录的 archify/ IR 生成的 HTML（见 prototype-review.md），存在时一并提供。
const archifyReference = resolve(import.meta.dir, 'archify/crewstation-platform.html');
const hasReference = await stat(archifyReference).then(() => true, () => false);
console.log(`Built design preview: ${output}${hasReference ? '' : ' (Archify 对照图缺席)'}`);
if (process.argv.includes('--serve')) {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 5202, fetch(request) {
    const file = new URL(request.url).pathname;
    if (['/brand/crewstation-mark.svg', '/brand/crewstation-mark-mono.svg'].includes(file)) return new Response(Bun.file(resolve(consoleRoot, 'public', file.slice(1))));
    if (file === '/archify/crewstation-platform.html') return hasReference ? new Response(Bun.file(archifyReference)) : new Response('Archify reference not generated', { status: 404 });
    if (!['/', '/index.html', '/responsive.html', '/entry.js', '/entry.css'].includes(file)) return new Response('Not found', { status: 404 });
    return new Response(Bun.file(resolve(output, file === '/' ? 'index.html' : file.slice(1))));
  } });
  console.log(`Design preview: ${server.url}`);
}
