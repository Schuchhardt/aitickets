#!/usr/bin/env node
// Publica la Edge Function tenant-router con la Frameworks API de Netlify: la copia a
// .netlify/v1/edge-functions/ después de `astro build` (ver el comentario en tenant-router.ts).
// Uso (en el build): astro build && node netlify/tenant-router/emit.mjs
// No hace nada fuera de Netlify salvo que se pase --force (para probar localmente).
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const force = process.argv.includes('--force')

if (process.env.TENANT_ROUTER_DISABLED === 'true') {
  console.log('tenant-router: desactivado (TENANT_ROUTER_DISABLED=true)')
  process.exit(0)
}
if (!process.env.NETLIFY && !force) {
  console.log('tenant-router: omitido (no es un build de Netlify; usa --force para emitirlo igual)')
  process.exit(0)
}

const outDir = join(root, '.netlify', 'v1', 'edge-functions')
mkdirSync(outDir, { recursive: true })
copyFileSync(join(here, 'tenant-router.ts'), join(outDir, 'tenant-router.ts'))
console.log(`tenant-router: Edge Function emitida en ${join('.netlify', 'v1', 'edge-functions', 'tenant-router.ts')}`)
