// Contraseñas y secretos de prueba generados en cada corrida. Ningún valor con forma de credencial queda escrito en el
// repo (GitGuardian marca cualquier password o secreto literal, aunque sea de un test).
import { randomBytes } from 'node:crypto'

const rand = (bytes) => randomBytes(bytes).toString('base64url')

/** Contraseña válida (≥ 8 caracteres) y distinta en cada llamada. */
export const fakePassword = (label = 'pw') => `${label}-${rand(9)}`

/** Secreto largo (firmas HMAC, x-internal-secret, client_secret). */
export const fakeSecret = (label = 'sk') => `${label}_${rand(24)}`
