# Runbook: backfill de `app_metadata.app = 'aitickets'`

## Por qué

El proyecto de Supabase es compartido con otras apps. Según el contrato R5, AI Tickets solo puede banear
o cambiar el correo de identidades de Auth marcadas con `app_metadata.app = 'aitickets'`
(`src/pages/api/team/_team.ts`, `src/pages/api/users/update.ts`). Los usuarios creados antes de que
`/api/auth/register` agregara esa marca no la tienen, así que en esos casos solo se puede cambiar
`public.users.active`. Este script marca las identidades antiguas que son inequívocamente nuestras.

## Qué hace

`scripts/backfill-app-metadata.mjs` recorre `public.users` (filas con `auth_user_id` no nulo, paginado)
y, por cada una, lee el usuario de Auth con `auth.admin.getUserById`:

| Situación | Acción |
| --- | --- |
| Sin `app_metadata.app`, el correo de Auth = correo de `public.users` (sin distinguir mayúsculas) y ambos se crearon con a lo más 10 minutos de diferencia | `tag`: agrega `app: 'aitickets'` conservando las demás claves de `app_metadata` |
| Sin `app_metadata.app`, correos iguales, pero el usuario de Auth se creó más de 10 minutos antes o después que la fila de `public.users` (o falta alguna fecha) | `skip_preexisting_identity`: posible identidad de otra app que `/api/auth/register` vinculó al registrarse con la misma contraseña; no se toca, revisar manualmente |
| `app_metadata.app = 'aitickets'` | `already_tagged` |
| `app_metadata.app` con otro valor | `skip_other_app` (pertenece a otra app; se reporta, no se toca) |
| Correos distintos | `skip_email_mismatch` |
| Falta un correo | `skip_no_email` |
| `auth_user_id` sin usuario de Auth | `skip_auth_missing` |
| Otra fila ya usó el mismo `auth_user_id` | `skip_duplicate` |

Nunca modifica `user_metadata`, correo, contraseña ni baneos. Limita las llamadas a Auth a 5 por segundo.
Los correos se imprimen enmascarados (`s***@dominio.cl`).

## Cómo correrlo

Requiere `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en `.env` (clave de servicio de producción; correrlo
solo desde una máquina de confianza).

1. Simulación (por defecto, no escribe nada):

   ```sh
   node --env-file=.env scripts/backfill-app-metadata.mjs
   ```

2. Revisar la tabla y el resumen. Poner atención a `skip_other_app`, `skip_preexisting_identity` y `skip_email_mismatch`: esas
   identidades quedan sin marca a propósito; si alguna es realmente de AI Tickets, decidirlo caso a caso.
   Para `skip_preexisting_identity`, confirmar que ninguna otra app del proyecto use esa identidad antes de
   marcarla a mano: una vez marcada, un admin de la organización puede banearla o cambiarle el correo, y eso
   afecta a todas las apps.
3. Aplicar:

   ```sh
   node --env-file=.env scripts/backfill-app-metadata.mjs --apply
   ```

4. Volver a correr la simulación: las filas marcadas deben aparecer como `already_tagged`.
   El script es idempotente; se puede repetir sin riesgo.

El código de salida es 1 si hubo filas con `error` (se muestran con su mensaje en la columna `detalle`).

## Reversión

Para quitar la marca a un usuario puntual, desde el panel de Supabase (Authentication → usuario) o con
`auth.admin.updateUserById(id, { app_metadata: { app: null } })`. Sin la marca, AI Tickets vuelve a
limitarse a cambiar `public.users.active` para ese usuario.
