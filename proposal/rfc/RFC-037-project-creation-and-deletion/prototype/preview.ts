import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const source = import.meta.dir;
const consoleRoot = resolve(source, '../../../../apps/console');
const outdir = '/private/tmp/crewstation-rfc037-prototype';
await mkdir(outdir, { recursive: true });
const build = await Bun.build({ entrypoints: [resolve(source, 'main.tsx')], outdir, target: 'browser', minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'console-react', setup(builder) {
    builder.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, (args) => ({ path: Bun.resolveSync(args.path, consoleRoot) }));
  } }],
});
if (!build.success) { console.error(build.logs); process.exit(1); }
const tokens = await Bun.file(resolve(consoleRoot, 'src/app/theme/tokens.css')).text();
const light = tokens.match(/:root \{([\s\S]*?)\n\}/)?.[1] ?? '';
const dark = tokens.slice(tokens.indexOf('@media')).match(/:root \{([\s\S]*?)\n  \}/)?.[1] ?? '';
const css = Bun.file(resolve(outdir, 'main.css'));
await Bun.write(css, (await css.text()) + `\n:root[data-demo-theme=light]{${light};color-scheme:light}\n:root[data-demo-theme=dark]{${dark};color-scheme:dark}`);
if (process.argv.includes('--build')) { console.log(`Built prototype: ${outdir}`); process.exit(0); }
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PROTOTYPE_PORT ?? 5217), fetch(req) {
  const path = new URL(req.url).pathname;
  if (path === '/' || path === '/index.html') return new Response(Bun.file(resolve(source, 'index.html')));
  if (path === '/favicon.ico') return new Response(null, { status: 204 });
  if (path === '/main.js' || path === '/main.css') return new Response(Bun.file(resolve(outdir, path.slice(1))));
  return new Response('Not found', { status: 404 });
} });
console.log(`RFC-037 prototype: ${server.url} (static local preview only)`);
