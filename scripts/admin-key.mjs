#!/usr/bin/env node
// Genera la llave del MCP de administración (/api/admin/mcp) y su sha256. Ver docs/api/admin.md.
//   node scripts/admin-key.mjs            llave completa
//   node scripts/admin-key.mjs --readonly llave de solo lectura
// La llave en claro se muestra UNA vez: guárdala en tu gestor de contraseñas y pégala en Claude. En Netlify va
// solo el hash (AITICKETS_ADMIN_KEY_SHA256 o AITICKETS_ADMIN_READONLY_KEY_SHA256), scope Functions, contexto Production.
// Mismo formato que src/lib/admin-api/auth.ts (generateAdminKey).
import { createHash, randomBytes } from 'node:crypto'

const readonly = process.argv.includes('--readonly')
const key = 'aitkadm_' + randomBytes(32).toString('base64url')
const hash = createHash('sha256').update(key).digest('hex')
const envName = readonly ? 'AITICKETS_ADMIN_READONLY_KEY_SHA256' : 'AITICKETS_ADMIN_KEY_SHA256'

console.log(`Llave${readonly ? ' de solo lectura' : ''} del MCP de admin (cópiala ahora; no se vuelve a mostrar):\n`)
console.log(`  ${key}\n`)
console.log('En Netlify (Site settings > Environment variables), scope Functions, SOLO contexto Production:\n')
console.log(`  ${envName}=${hash}`)
console.log('  ADMIN_MCP_ENABLED=true\n')
console.log('En Claude (conector propio): URL https://aitickets.cl/api/admin/mcp, autenticación "No sign-in",')
console.log(`header Authorization = Bearer ${key.slice(0, 12)}…  (la llave completa de arriba)`)
console.log(`Huella para reconocerla en la bitácora: ${hash.slice(0, 8)}`)
