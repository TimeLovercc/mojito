// Online demo build (GitHub Pages): the web app plus mock/server.mjs running in a service worker, no server.
//   MOJITO_DEMO_BASE=/mojito EXPO_PUBLIC_MOJITO_TIMEZONE=America/Los_Angeles node demo/build-demo.mjs
// Needs esbuild and buffer next to the app's dependencies (npm i --no-save esbuild buffer). Output: dist-demo/.
// 1) expo export -p web with that base path; 2) bundle the mock with Node shims into demo-sw.js;
// 3) swap the app <script> for demo-boot.js, which sets the hub URL and token and waits for the worker.
import { execFileSync } from 'node:child_process'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const BASE = process.env.MOJITO_DEMO_BASE
if (BASE === undefined || !/^\/[a-z0-9-]+$/.test(BASE)) throw new Error(`MOJITO_DEMO_BASE must look like /mojito, got ${BASE}`)
const TIMEZONE = process.env.EXPO_PUBLIC_MOJITO_TIMEZONE
if (TIMEZONE === undefined) throw new Error('EXPO_PUBLIC_MOJITO_TIMEZONE is not set (the app bundle and the mock share it)')

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const OUT = 'dist-demo'
const out = join(root, OUT)

execFileSync('npx', ['expo', 'export', '-p', 'web', '--output-dir', OUT, '--clear'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, MOJITO_WEB_BASE_URL: BASE },
})

// named exports each node: module provides to mock/server.mjs
const NODE_MODULES = {
  'node:http': ['http', ['createServer']],
  'node:fs': ['fs', ['existsSync', 'readFileSync', 'statSync']],
  'node:path': ['path', ['dirname', 'extname', 'join', 'normalize', 'sep']],
  'node:url': ['url', ['fileURLToPath']],
  'node:crypto': ['crypto', ['generateKeyPairSync']],
}
const shims = join(here, 'node-shims.mjs')
const nodeShims = {
  name: 'node-shims',
  setup(b) {
    b.onResolve({ filter: /^node:/ }, (args) => {
      if (!(args.path in NODE_MODULES)) throw new Error(`mock imports ${args.path}, which the demo has no shim for`)
      return { path: args.path, namespace: 'node-shim' }
    })
    b.onLoad({ filter: /.*/, namespace: 'node-shim' }, (args) => {
      const [obj, names] = NODE_MODULES[args.path]
      return {
        contents: `import { ${obj} as m } from ${JSON.stringify(shims)}\n` + names.map((n) => `export const ${n} = m.${n}`).join('\n'),
        resolveDir: here,
      }
    })
  },
}
const bundled = await build({
  entryPoints: [join(root, 'mock', 'server.mjs')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  inject: [join(here, 'globals.mjs')],
  define: { 'import.meta.url': JSON.stringify('file:///mobile/mock/server.mjs') },
  loader: { '.json': 'text', '.png': 'binary' },
  plugins: [nodeShims],
  logLevel: 'warning',
})

function fill(text, anchor, value, file) {
  const hits = text.split(anchor).length - 1
  if (hits !== 1) throw new Error(`${file}: placeholder ${anchor} found ${hits} times, expected 1`)
  return text.replace(anchor, () => value)
}

let sw = readFileSync(join(here, 'sw.js'), 'utf8')
sw = fill(sw, '__MOJITO_DEMO_HUB__', `${BASE}/hub`, 'sw.js')
sw = fill(sw, '__MOJITO_DEMO_TIMEZONE__', TIMEZONE, 'sw.js')
sw = fill(sw, '__MOJITO_DEMO_MOCK__', bundled.outputFiles[0].text, 'sw.js')
writeFileSync(join(out, 'demo-sw.js'), sw)

const htmlPath = join(out, 'index.html')
let html = readFileSync(htmlPath, 'utf8')
const scripts = [...html.matchAll(/<script src="([^"]+)" defer><\/script>/g)]
if (scripts.length !== 1) throw new Error(`index.html: expected 1 app <script>, found ${scripts.length}`)
let boot = readFileSync(join(here, 'boot.js'), 'utf8')
boot = fill(boot, '__MOJITO_DEMO_BASE__', BASE, 'boot.js')
boot = fill(boot, '__MOJITO_DEMO_APP__', scripts[0][1], 'boot.js')
writeFileSync(join(out, 'demo-boot.js'), boot)
html = fill(html, scripts[0][0], `<script src="${BASE}/demo-boot.js"></script>`, 'index.html')
html = fill(
  html,
  '</style>',
  '</style>\n    <style id="mojito-demo">#mojito-demo-tag{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
    'pointer-events:none;padding:3px 10px;border-radius:999px;font:500 11px/16px -apple-system,BlinkMacSystemFont,sans-serif;' +
    'color:#fff;background:rgba(31,143,95,.9)}</style>',
  'index.html',
)
writeFileSync(htmlPath, html)
// GitHub Pages answers unknown paths with 404.html: serve the app there too so deep links load
copyFileSync(htmlPath, join(out, '404.html'))
writeFileSync(join(out, '.nojekyll'), '')
console.log(`${OUT} ready: base ${BASE}, timezone ${TIMEZONE}, mock ${Math.round(bundled.outputFiles[0].text.length / 1024)} KB`)
