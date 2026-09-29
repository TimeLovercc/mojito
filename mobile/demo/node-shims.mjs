// Browser stand-ins for the Node APIs mock/server.mjs uses, so it can run inside the demo's service worker.
// build-demo.mjs aliases node:http / node:fs / node:path / node:url / node:crypto to the named exports below.
import seedText from '../../docs/seed.example.json'
import extraText from '../mock/extra.json'
import avatar from '../assets/widget-avatar.png'
import { Buffer } from './buffer.mjs'

const demo = () => globalThis.__mojitoDemo

export const http = {
  createServer: (handler) => ({
    listen() {
      demo().handler = handler
      return this
    },
  }),
}

const FILES = {
  '/docs/seed.example.json': seedText,
  '/mobile/mock/extra.json': extraText,
  '/mobile/assets/widget-avatar.png': Buffer.from(avatar),
}
function unsupported(name) {
  return () => {
    throw new Error(`${name} is not available in the browser demo`)
  }
}
export const fs = {
  readFileSync(path) {
    if (!(path in FILES)) throw new Error(`demo has no file ${path}`)
    return FILES[path]
  },
  existsSync: unsupported('fs.existsSync'),
  statSync: unsupported('fs.statSync'),
}

function normalize(p) {
  const out = []
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return '/' + out.join('/')
}
export const path = {
  sep: '/',
  normalize,
  join: (...parts) => normalize(parts.join('/')),
  dirname: (p) => normalize(p + '/..'),
  extname: (p) => {
    const base = p.slice(p.lastIndexOf('/') + 1)
    return base.includes('.') ? base.slice(base.lastIndexOf('.')) : ''
  },
}

export const url = { fileURLToPath: (u) => new URL(u).pathname }

// VAPID public key for GET /push/vapid-public-key; Web Push is a no-op in the demo, so any valid P-256 point shape will do
export const crypto = {
  generateKeyPairSync: () => ({
    publicKey: { export: () => ({ x: Buffer.alloc(32, 1).toString('base64url'), y: Buffer.alloc(32, 2).toString('base64url') }) },
  }),
}
