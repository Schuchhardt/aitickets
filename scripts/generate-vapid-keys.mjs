#!/usr/bin/env node
import { generateVAPIDKeys } from 'web-push'

const keys = generateVAPIDKeys()
console.log('Agrega estas variables de entorno en Netlify:\n')
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`)
console.log(`VAPID_SUBJECT=mailto:soporte@aitickets.cl`)
console.log('\nGuarda la clave privada en un lugar seguro. No la subas al repositorio.')
