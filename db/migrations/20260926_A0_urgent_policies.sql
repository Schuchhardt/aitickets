-- URGENTE: se puede aplicar HOY, con el código actual en producción.
--
-- Cierra dos agujeros que existen hoy vía PostgREST con la anon key (que estaba en el bundle
-- del cliente, así que hay que considerarla pública) y el JWT de cualquier usuario logueado
-- (incluidos los usuarios de otras apps del proyecto compartido):
--   1. "Enable update for own profile" en public.users no tiene WITH CHECK: un usuario puede
--      cambiarse organization_id y role y quedar como admin de otra organización.
--   2. "Enable update for organization owners" en public.organizations deja a cualquier miembro
--      (incluido un validador) editar la organización directamente, saltándose los roles.
--
-- El código actual en producción ya escribe users/organizations con la service role
-- (api/users/update, api/organizations/update, register), así que quitar estas políticas no
-- rompe la app. Solo toca políticas de tablas de AI Tickets. Es idempotente.

DROP POLICY IF EXISTS "Enable update for own profile" ON public.users;
DROP POLICY IF EXISTS "Enable update for organization owners" ON public.organizations;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.organizations;

-- Blindaje adicional: ni anon ni authenticated pueden escribir en estas tablas.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.users FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.organizations FROM anon, authenticated;
