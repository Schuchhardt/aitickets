# Migraciones 2026-09-26 (rama fix/growth-blockers)

El proyecto de Supabase es **compartido** con otras apps. Estas migraciones solo tocan tablas de AI Tickets y son idempotentes. Revisarlas antes de aplicarlas.

Orden:

0. `20260926_A0_urgent_policies.sql`: **aplicar YA, con el código actual en producción.** Elimina la política de UPDATE de `users` sin `WITH CHECK` (un usuario podía cambiarse `organization_id`/`role` y quedar como admin de otra organización) y las de escritura de `organizations`.
1. `20260926_B_orders.sql`: columnas nuevas en `event_orders` (atribución, datos del comprador, control del email) más índices. **Antes del deploy.**
2. `20260926_C_dashboard.sql`: tabla `organization_payout_accounts` (datos bancarios; RLS sin políticas) y columnas de atribución de registro en `organizations`. **Antes del deploy.**
3. `20260926_D_functions.sql`: `event_tickets.event_date_id` (entradas por función). **Antes del deploy.**
4. Deploy del código (todo el acceso ya es con service role). Configurar las variables de entorno nuevas (ver `.env.example`); `INTERNAL_API_SECRET` y `SITE_URL` deben estar disponibles en *Builds* y *Functions*.
5. `20260926_Z_lockdown_rls.sql`: activa RLS sin políticas, revoca permisos a `anon`/`authenticated` en todas las tablas de AI Tickets y limpia `event_visits.ip_raw`. **Después del deploy**, confirmando antes que ninguna otra app del proyecto usa estas tablas con la anon key.

Después del paso 5, correr los Security Advisors de Supabase y rotar la anon key si ninguna otra app la necesita (estuvo expuesta en el bundle del cliente).
