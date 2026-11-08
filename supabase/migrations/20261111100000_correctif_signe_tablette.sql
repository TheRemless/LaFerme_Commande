-- Correctif du lot 7c : Supabase refuse un UPDATE sans WHERE appelé par l'API (extension safeupdate).
-- signe_tablette mettait à jour l'unique ligne de surveillance_etat sans condition.
create or replace function signe_tablette() returns void
language sql as $$
  update surveillance_etat set tablette_vue_le = now() where id;
$$;
