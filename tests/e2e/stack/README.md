# E2E con base de datos real (local)

Prueban el panel del organizador y de su equipo de punta a punta contra una base **real pero local y desechable**:
un stack de Supabase en Docker (Postgres 15.8 —la versión de producción—, Auth/GoTrue y PostgREST, con las mismas
imágenes que usa el CLI de Supabase) donde se aplican `db/schema.sql` y **todas** las migraciones con el mismo runner del
deploy. Así se prueba lo que de verdad crea el repo, incluido el trigger `on_auth_user_created` de `auth.users`.

```bash
node tests/e2e/stack/setup.mjs                      # levanta el stack y escribe tests/e2e/stack/.stack.env
npx playwright test -c playwright.stack.config.ts   # corre los specs de esta carpeta
node tests/e2e/stack/setup.mjs --down               # baja el stack y borra sus datos
```

- Nunca apunta a producción: `playwright.stack.config.ts` exige que la base y Supabase estén en 127.0.0.1.
- Los correos no salen: el mailer los escribe en `MAIL_OUTBOX_DIR` (`test-results/stack-outbox`) y los tests leen
  de ahí el link de verificación o de la invitación (`helpers.ts`: `waitForMailLink`).
- Turnstile usa las claves de prueba de Cloudflare (siempre aprueban).
- En la CI corre en el job `e2e-stack` (`.github/workflows/ci.yml`).

| Spec | Qué prueba |
|---|---|
| `signup.spec.ts` | registro → correo de verificación → onboarding → panel; quien crea la organización queda como `producer` |
| `team.spec.ts` | invitar desde el panel, aceptar con cuenta nueva, huérfanos, otra organización, anular, reenviar acceso, límites del administrador (no invita admins ni finanzas, no toma cuentas ni cambia la cuenta bancaria) |
| `roles.spec.ts` | matriz de los 6 roles × todas las páginas del panel; falla si una página nueva no está declarada |

Para sembrar datos usa `helpers.ts` (`createOrganization`, `addMember`, `createEvent`, `login`, `sql`): crean cuentas
reales en Auth y dejan que el trigger `handle_new_user` cree la fila de `public.users`, como en producción.
