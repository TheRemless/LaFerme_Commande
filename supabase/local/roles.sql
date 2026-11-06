-- Rôles et droits par défaut de Supabase, recréés pour la base locale PGlite et les tests.
-- Ne jamais appliquer sur le projet Supabase : ils y existent déjà.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
