-- Contraseñas de los roles de servicio del Postgres de Supabase (como el docker-compose de self-hosting de Supabase).
-- Solo para el stack local de e2e (tests/e2e/stack/docker-compose.yml).
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER pgbouncer WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
